/**
 * Managing other accounts: approval of new users, password reset codes.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomCode, sha256Hex } from '../auth/crypto';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { getDb } from '../db/client';
import { passwordResetCodes, userRoles, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';

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
