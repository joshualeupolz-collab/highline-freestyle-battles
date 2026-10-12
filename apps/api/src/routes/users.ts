/**
 * Managing other accounts: approval of new users, password reset codes, roles.
 */

import { roleChangeRequestSchema, SPECIAL_ROLES } from '@hfb/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomCode, sha256Hex } from '../auth/crypto';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { getDb } from '../db/client';
import {
  battleParticipants,
  battles,
  formats,
  passwordResetCodes,
  ratingHistory,
  ratingStates,
  userRoles,
  users,
} from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { displayParams, ratingView } from '../services/ratingView';

const RESET_CODE_VALIDITY = 24 * 60 * 60_000;

export const userRoutes = new Hono<AppEnv>();
userRoutes.use(requireUser({ active: true }));

/**
 * Find active users by the start of their username (`?q=`, at least 2 characters).
 * Uses the index on lower(username), so it does not scan the whole table.
 */
userRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return c.json({ users: [] });
  const rows = await getDb(c.env.DB)
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) >= ${q}`,
        sql`lower(${users.username}) < ${`${q}\u{10FFFF}`}`,
        eq(users.status, 'active'),
      ),
    )
    .orderBy(sql`lower(${users.username})`)
    .limit(20);
  return c.json({ users: rows });
});

/** Accounts waiting for approval, oldest first, with their questionnaire answers. */
userRoutes.get('/pending', async (c) => {
  if (!can.approveUsers(c.get('user'))) apiError(403, 'forbidden');
  const rows = await getDb(c.env.DB)
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      questionnaireJson: users.questionnaireJson,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.status, 'pending'))
    .orderBy(users.createdAt);
  return c.json({
    users: rows.map(({ questionnaireJson, ...rest }) => ({
      ...rest,
      questionnaire: questionnaireJson ? (JSON.parse(questionnaireJson) as unknown) : null,
    })),
  });
});

/** Approve a pending account. Records who approved whom (invitation tree) and audits it. */
userRoutes.post('/:id/approve', async (c) => {
  const actor = c.get('user');
  if (!actor || !can.approveUsers(actor)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const targetId = c.req.param('id');
  const now = Date.now();

  const target = await db.select().from(users).where(eq(users.id, targetId)).get();
  if (!target) apiError(404, 'not_found');
  if (target.status !== 'pending') apiError(409, 'not_pending');

  await db.batch([
    db
      .update(users)
      .set({ status: 'active', approvedBy: actor.id, approvedAt: now })
      .where(and(eq(users.id, targetId), eq(users.status, 'pending'))),
    db.insert(userRoles).values({
      id: newId(now),
      userId: targetId,
      role: 'athlete',
      grantedBy: actor.id,
      grantedAt: now,
    }),
    auditInsert(
      db,
      { actorId: actor.id, action: 'user.approve', targetType: 'user', targetId },
      now,
    ),
  ]);
  return c.json({ ok: true });
});

/**
 * Create a one-time code the user can set a new password with. The code is shown once and
 * handed over personally; only its hash is stored. Earlier unused codes stop working.
 */
userRoutes.post('/:id/password-reset-code', async (c) => {
  const actor = c.get('user');
  const targetId = c.req.param('id');
  if (!actor || !can.createPasswordResetCode(actor, targetId)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();

  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).get();
  if (!target) apiError(404, 'not_found');

  const code = randomCode();
  const expiresAt = now + RESET_CODE_VALIDITY;
  await db.batch([
    db
      .update(passwordResetCodes)
      .set({ usedAt: now })
      .where(and(eq(passwordResetCodes.userId, targetId), isNull(passwordResetCodes.usedAt))),
    db.insert(passwordResetCodes).values({
      id: await sha256Hex(code),
      userId: targetId,
      createdBy: actor.id,
      createdAt: now,
      expiresAt,
    }),
    auditInsert(
      db,
      { actorId: actor.id, action: 'user.password_reset_code', targetType: 'user', targetId },
      now,
    ),
  ]);
  return c.json({ code, expiresAt }, 201);
});

/** Everyone holding a special role (judge, organizer, federation, admin), for the team list. */
userRoutes.get('/staff', async (c) => {
  const rows = await getDb(c.env.DB)
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: userRoles.role,
      grantedAt: userRoles.grantedAt,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(isNull(userRoles.revokedAt), inArray(userRoles.role, [...SPECIAL_ROLES])))
    .orderBy(userRoles.role, sql`lower(${users.username})`);
  return c.json({ staff: rows });
});

/** Hand out a special role (see `can.changeRole`). */
userRoutes.post('/:id/roles', async (c) => {
  const actor = c.get('user');
  const targetId = c.req.param('id');
  const { role, reason } = await parseJson(c, roleChangeRequestSchema);
  if (!actor || !can.changeRole(actor, role, targetId)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();

  const target = await db.select().from(users).where(eq(users.id, targetId)).get();
  if (!target) apiError(404, 'not_found');
  if (target.status !== 'active') apiError(409, 'user_not_active');
  const existing = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(eq(userRoles.userId, targetId), eq(userRoles.role, role), isNull(userRoles.revokedAt)),
    )
    .get();
  if (existing) apiError(409, 'role_already_held');

  await db.batch([
    db
      .insert(userRoles)
      .values({ id: newId(now), userId: targetId, role, grantedBy: actor.id, grantedAt: now }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'user.role_grant',
        targetType: 'user',
        targetId,
        reason: reason || null,
        payload: { role },
      },
      now,
    ),
  ]);
  return c.json({ ok: true }, 201);
});

/** Take back a special role. The grant stays as history (`revoked_at`). */
userRoutes.post('/:id/roles/revoke', async (c) => {
  const actor = c.get('user');
  const targetId = c.req.param('id');
  const { role, reason } = await parseJson(c, roleChangeRequestSchema);
  if (!actor || !can.changeRole(actor, role, targetId)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();

  const grant = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(eq(userRoles.userId, targetId), eq(userRoles.role, role), isNull(userRoles.revokedAt)),
    )
    .get();
  if (!grant) apiError(404, 'role_not_held');

  await db.batch([
    db
      .update(userRoles)
      .set({ revokedAt: now, revokedBy: actor.id })
      .where(eq(userRoles.id, grant.id)),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'user.role_revoke',
        targetType: 'user',
        targetId,
        reason: reason || null,
        payload: { role },
      },
      now,
    ),
  ]);
  return c.json({ ok: true });
});

/**
 * Public profile for logged-in users: ratings per format, who approved the account and the
 * latest battles with their rating change.
 */
userRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user || user.status === 'deleted') apiError(404, 'not_found');

  const [roles, approver, states, params] = await Promise.all([
    db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, id), isNull(userRoles.revokedAt))),
    user.approvedBy
      ? db
          .select({ id: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, user.approvedBy))
          .get()
      : Promise.resolve(undefined),
    db
      .select({ state: ratingStates, formatName: formats.name })
      .from(ratingStates)
      .innerJoin(formats, eq(formats.id, ratingStates.formatId))
      .where(eq(ratingStates.userId, id)),
    displayParams(db),
  ]);

  const mine = await db
    .select({
      battle: battles,
      score: battleParticipants.score,
      placement: battleParticipants.placement,
    })
    .from(battleParticipants)
    .innerJoin(battles, eq(battles.id, battleParticipants.battleId))
    .where(and(eq(battleParticipants.userId, id), sql`${battles.status} <> 'open'`))
    .orderBy(desc(battles.createdAt))
    .limit(20);
  const battleIds = mine.map((m) => m.battle.id);
  const [opponents, history, formatRows] = battleIds.length
    ? await Promise.all([
        db
          .select({
            battleId: battleParticipants.battleId,
            userId: users.id,
            username: users.username,
            displayName: users.displayName,
          })
          .from(battleParticipants)
          .innerJoin(users, eq(users.id, battleParticipants.userId))
          .where(
            and(
              inArray(battleParticipants.battleId, battleIds),
              sql`${battleParticipants.userId} <> ${id}`,
            ),
          ),
        db
          .select()
          .from(ratingHistory)
          .where(and(inArray(ratingHistory.battleId, battleIds), eq(ratingHistory.userId, id))),
        db.select({ id: formats.id, name: formats.name }).from(formats),
      ])
    : [[], [], []];

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      roles: roles.map((r) => r.role).sort(),
      approvedBy: approver ?? null,
    },
    ratings: states
      .map(({ state, formatName }) => ({
        formatId: state.formatId,
        formatName,
        ...ratingView(state, params),
      }))
      .sort((a, b) => b.nBattles - a.nBattles),
    battles: mine.map(({ battle, score, placement }) => {
      const h = history.find((x) => x.battleId === battle.id);
      return {
        id: battle.id,
        formatId: battle.formatId,
        formatName: formatRows.find((f) => f.id === battle.formatId)?.name ?? null,
        status: battle.status,
        createdAt: battle.createdAt,
        decidedAt: battle.decidedAt,
        score,
        placement,
        opponents: opponents
          .filter((o) => o.battleId === battle.id)
          .map(({ battleId: _, ...o }) => o),
        ratingChange: h ? Math.round(h.rAfter - h.rBefore) : null,
      };
    }),
  });
});
