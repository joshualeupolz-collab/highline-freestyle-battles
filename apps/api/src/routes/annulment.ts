/**
 * Annulment (concept section 11) and the federation's approval of sport-related admin actions
 * (concept section 2).
 *
 * - A federation member annuls a decided battle with a reason. The battle becomes `annulled`
 *   and a replay request makes the next replay remove it from every rating.
 * - An admin without the federation role needs a federation member's approval: the request
 *   waits in `federation_approvals`. As long as nobody holds the federation role, the admin acts
 *   alone (as with formats and RuleSets in stage 1).
 * - Nobody annuls, approves or requests for a battle they took part in.
 */
import { annulBattleSchema, decideApprovalSchema } from '@hfb/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { hasRole } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import {
  battleParticipants,
  battles,
  federationApprovals,
  replayRequests,
  userRoles,
  users,
} from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';

/** Mounted at /api/battles. */
export const annulmentRoutes = new Hono<AppEnv>();
annulmentRoutes.use(requireUser({ active: true }));

/** Mounted at /api/federation-approvals. */
export const approvalRoutes = new Hono<AppEnv>();
approvalRoutes.use(requireUser({ active: true }));

async function participantIds(db: Database, battleId: string) {
  const rows = await db
    .select({ userId: battleParticipants.userId })
    .from(battleParticipants)
    .where(eq(battleParticipants.battleId, battleId));
  return rows.map((r) => r.userId);
}

async function federationExists(db: Database) {
  const row = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.role, 'federation'),
        isNull(userRoles.revokedAt),
        eq(users.status, 'active'),
      ),
    )
    .get();
  return !!row;
}

/** The statements that annul a battle; `approvedBy` = the federation member who approved. */
function annulStatements(
  db: Database,
  battle: { id: string; formatId: string; eventAt: number | null },
  actorId: string,
  reason: string,
  now: number,
  approvedBy: string | null,
) {
  return [
    db
      .update(battles)
      .set({ status: 'annulled', annulledBy: actorId, annulledAt: now, annulReason: reason })
      .where(and(eq(battles.id, battle.id), eq(battles.status, 'decided'))),
    db.insert(replayRequests).values({
      id: newId(now),
      formatId: battle.formatId,
      fromEventAt: battle.eventAt,
      reason: `Battle ${battle.id} annulled`,
      requestedBy: actorId,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId,
        action: 'battle.annul',
        targetType: 'battle',
        targetId: battle.id,
        reason,
        federationApprovalBy: approvedBy,
      },
      now,
    ),
  ] as const;
}

async function loadDecidedBattle(db: Database, id: string) {
  const battle = await db
    .select({
      id: battles.id,
      status: battles.status,
      formatId: battles.formatId,
      eventAt: battles.eventAt,
    })
    .from(battles)
    .where(eq(battles.id, id))
    .get();
  if (!battle) apiError(404, 'not_found');
  if (battle.status !== 'decided') apiError(409, 'not_decided');
  return battle;
}

/**
 * Annul a decided battle. Federation: at once. Admin: at once while no federation member exists,
 * otherwise a request for approval (202).
 */
annulmentRoutes.post('/:id/annul', async (c) => {
  const actor = c.get('user');
  if (!actor || !hasRole(actor, 'federation', 'admin')) apiError(403, 'forbidden');
  const { reason } = await parseJson(c, annulBattleSchema);
  const db = getDb(c.env.DB);
  const battle = await loadDecidedBattle(db, c.req.param('id'));
  if ((await participantIds(db, battle.id)).includes(actor.id))
    apiError(403, 'conflict_of_interest');
  const now = Date.now();

  if (hasRole(actor, 'federation') || !(await federationExists(db))) {
    await db.batch(annulStatements(db, battle, actor.id, reason, now, null));
    return c.json({ status: 'annulled' });
  }

  const pending = await db
    .select({ id: federationApprovals.id })
    .from(federationApprovals)
    .where(
      and(
        eq(federationApprovals.targetType, 'battle'),
        eq(federationApprovals.targetId, battle.id),
        eq(federationApprovals.status, 'pending'),
      ),
    )
    .get();
  if (pending) apiError(409, 'approval_pending');
  const id = newId(now);
  await db.batch([
    db.insert(federationApprovals).values({
      id,
      action: 'battle.annul',
      targetType: 'battle',
      targetId: battle.id,
      reason,
      requestedBy: actor.id,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'battle.annul_request',
        targetType: 'battle',
        targetId: battle.id,
        reason,
      },
      now,
    ),
  ]);
  return c.json({ status: 'pending_approval', id }, 202);
});

/** Requests waiting for the federation (visible to federation and admins). */
approvalRoutes.get('/', async (c) => {
  const actor = c.get('user');
  if (!actor || !hasRole(actor, 'federation', 'admin')) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: federationApprovals.id,
      action: federationApprovals.action,
      targetType: federationApprovals.targetType,
      targetId: federationApprovals.targetId,
      reason: federationApprovals.reason,
      createdAt: federationApprovals.createdAt,
      requestedBy: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
      },
    })
    .from(federationApprovals)
    .innerJoin(users, eq(users.id, federationApprovals.requestedBy))
    .where(eq(federationApprovals.status, 'pending'))
    .orderBy(federationApprovals.createdAt)
    .limit(100);
  const battleIds = rows.filter((r) => r.targetType === 'battle').map((r) => r.targetId);
  const involved = battleIds.length
    ? await db
        .select({ battleId: battleParticipants.battleId, userId: battleParticipants.userId })
        .from(battleParticipants)
        .where(inArray(battleParticipants.battleId, battleIds))
    : [];
  return c.json({
    approvals: rows.map((r) => ({
      ...r,
      // A federation member may decide unless they asked for it or took part in the battle.
      canDecide:
        hasRole(actor, 'federation') &&
        r.requestedBy.id !== actor.id &&
        !involved.some((p) => p.battleId === r.targetId && p.userId === actor.id),
      canWithdraw: r.requestedBy.id === actor.id,
    })),
  });
});

/** A federation member approves (carries the action out) or rejects a request. */
approvalRoutes.post('/:id/decide', async (c) => {
  const actor = c.get('user');
  if (!actor || !hasRole(actor, 'federation')) apiError(403, 'forbidden');
  const { decision, note } = await parseJson(c, decideApprovalSchema);
  const db = getDb(c.env.DB);
  const request = await db
    .select()
    .from(federationApprovals)
    .where(eq(federationApprovals.id, c.req.param('id')))
    .get();
  if (!request) apiError(404, 'not_found');
  if (request.status !== 'pending') apiError(409, 'approval_decided');
  if (request.requestedBy === actor.id) apiError(403, 'cannot_approve_own_request');
  if ((await participantIds(db, request.targetId)).includes(actor.id))
    apiError(403, 'conflict_of_interest');

  const now = Date.now();
  const resolve = db
    .update(federationApprovals)
    .set({
      status: decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: note || null,
    })
    .where(and(eq(federationApprovals.id, request.id), eq(federationApprovals.status, 'pending')));

  if (decision === 'reject') {
    await db.batch([
      resolve,
      auditInsert(
        db,
        {
          actorId: actor.id,
          action: 'federation.reject',
          targetType: request.targetType,
          targetId: request.targetId,
          reason: note || null,
          payload: { approvalId: request.id, action: request.action },
        },
        now,
      ),
    ]);
    return c.json({ status: 'rejected' });
  }

  // The only action so far: annul the battle, in the name of the admin who asked for it.
  const battle = await loadDecidedBattle(db, request.targetId);
  await db.batch([
    resolve,
    ...annulStatements(db, battle, request.requestedBy, request.reason, now, actor.id),
  ]);
  return c.json({ status: 'annulled' });
});

/** The admin takes back their own request. */
approvalRoutes.post('/:id/withdraw', async (c) => {
  const actor = c.get('user');
  if (!actor) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const request = await db
    .select()
    .from(federationApprovals)
    .where(eq(federationApprovals.id, c.req.param('id')))
    .get();
  if (!request) apiError(404, 'not_found');
  if (request.requestedBy !== actor.id) apiError(403, 'forbidden');
  if (request.status !== 'pending') apiError(409, 'approval_decided');
  await db
    .update(federationApprovals)
    .set({ status: 'withdrawn', decidedAt: Date.now() })
    .where(and(eq(federationApprovals.id, request.id), eq(federationApprovals.status, 'pending')));
  return c.json({ status: 'withdrawn' });
});
