/**
 * Initial rating estimates (rating specification section 6.1, concept section 3).
 *
 * - Possible while the person has fewer than `MIN_BATTLES` battles in the format.
 * - Only the latest estimate per estimator counts; giving a new one withdraws the old one.
 * - Nobody estimates themselves. The estimated person does not see who estimated them; the
 *   federation and admins do.
 * - The Worker uses estimates when a person plays their first battle in a format. An estimate
 *   given (or withdrawn) after that changes the starting value retroactively, so it requests a
 *   replay.
 */
import { createEstimateSchema } from '@hfb/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { hasRole } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import { formats, ratingEstimates, ratingStates, replayRequests, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { displayParams } from '../services/ratingView';

export const estimateRoutes = new Hono<AppEnv>();
estimateRoutes.use(requireUser({ active: true }));

/** The format whose rating counts (a merged format counts for the one it was merged into). */
async function ratingFormat(db: Database, formatId: string) {
  const format = await db.select().from(formats).where(eq(formats.id, formatId)).get();
  if (!format || format.archivedAt !== null || format.approvedAt === null) return null;
  return format.mergedInto ?? format.id;
}

async function battlesIn(db: Database, userId: string, formatId: string) {
  const state = await db
    .select({ nBattles: ratingStates.nBattles })
    .from(ratingStates)
    .where(and(eq(ratingStates.userId, userId), eq(ratingStates.formatId, formatId)))
    .get();
  return state?.nBattles ?? 0;
}

function replayStatement(db: Database, formatId: string, actorId: string, now: number) {
  return db.insert(replayRequests).values({
    id: newId(now),
    formatId,
    reason: 'Initial estimate changed after the first battles',
    requestedBy: actorId,
    createdAt: now,
  });
}

/** Give (or replace) my estimate of a person in a format. */
estimateRoutes.post('/', async (c) => {
  const actor = c.get('user');
  if (!actor || !hasRole(actor, 'athlete', 'federation', 'admin')) apiError(403, 'forbidden');
  const input = await parseJson(c, createEstimateSchema);
  if (input.subjectId === actor.id) apiError(400, 'cannot_estimate_yourself');
  const kind = input.official
    ? hasRole(actor, 'federation')
      ? 'federation'
      : hasRole(actor, 'admin')
        ? 'admin'
        : apiError(403, 'forbidden')
    : 'athlete';
  const db = getDb(c.env.DB);
  const subject = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, input.subjectId))
    .get();
  if (subject?.status !== 'active') apiError(404, 'not_found');
  const formatId = await ratingFormat(db, input.formatId);
  if (!formatId) apiError(400, 'unknown_format');
  const [played, params] = await Promise.all([
    battlesIn(db, input.subjectId, formatId),
    displayParams(db),
  ]);
  if (played >= params.minBattles) apiError(409, 'too_many_battles');

  const now = Date.now();
  const id = newId(now);
  const mine = and(
    eq(ratingEstimates.subjectId, input.subjectId),
    eq(ratingEstimates.formatId, formatId),
    eq(ratingEstimates.estimatorId, actor.id),
    eq(ratingEstimates.kind, kind),
    isNull(ratingEstimates.withdrawnAt),
  );
  await db.batch([
    db.update(ratingEstimates).set({ withdrawnAt: now }).where(mine),
    db.insert(ratingEstimates).values({
      id,
      subjectId: input.subjectId,
      estimatorId: actor.id,
      formatId,
      kind,
      value: input.value,
      createdAt: now,
    }),
    ...(played > 0 ? [replayStatement(db, formatId, actor.id, now)] : []),
    ...(kind === 'athlete'
      ? []
      : [
          auditInsert(
            db,
            {
              actorId: actor.id,
              action: 'rating.estimate',
              targetType: 'user',
              targetId: input.subjectId,
              payload: { formatId, value: input.value, kind },
            },
            now,
          ),
        ]),
  ]);
  return c.json({ id, replay: played > 0 }, 201);
});

/** Withdraw one of my estimates. */
estimateRoutes.post('/:id/withdraw', async (c) => {
  const actor = c.get('user');
  if (!actor) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const estimate = await db
    .select()
    .from(ratingEstimates)
    .where(eq(ratingEstimates.id, c.req.param('id')))
    .get();
  if (!estimate || estimate.estimatorId !== actor.id) apiError(404, 'not_found');
  if (estimate.withdrawnAt !== null) return c.json({ ok: true });
  const played = await battlesIn(db, estimate.subjectId, estimate.formatId);
  const now = Date.now();
  await db.batch([
    db.update(ratingEstimates).set({ withdrawnAt: now }).where(eq(ratingEstimates.id, estimate.id)),
    ...(played > 0 ? [replayStatement(db, estimate.formatId, actor.id, now)] : []),
  ]);
  return c.json({ ok: true });
});

/**
 * Estimates of one person (`?subjectId=`): my own for everyone; all of them, with who gave
 * them, for the federation and admins. The person themselves sees only the number of estimates.
 */
estimateRoutes.get('/', async (c) => {
  const actor = c.get('user');
  if (!actor) apiError(401, 'not_logged_in');
  const subjectId = c.req.query('subjectId') ?? '';
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: ratingEstimates.id,
      formatId: ratingEstimates.formatId,
      kind: ratingEstimates.kind,
      value: ratingEstimates.value,
      createdAt: ratingEstimates.createdAt,
      estimator: { id: users.id, username: users.username, displayName: users.displayName },
    })
    .from(ratingEstimates)
    .innerJoin(users, eq(users.id, ratingEstimates.estimatorId))
    .where(and(eq(ratingEstimates.subjectId, subjectId), isNull(ratingEstimates.withdrawnAt)))
    .orderBy(desc(ratingEstimates.createdAt));
  const staff = hasRole(actor, 'federation', 'admin');
  return c.json({
    mine: rows.filter((r) => r.estimator.id === actor.id).map(({ estimator: _, ...r }) => r),
    count: rows.length,
    all: staff && subjectId !== actor.id ? rows : null,
  });
});
