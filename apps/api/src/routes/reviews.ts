/**
 * Review levels 2–3 (concept 7.2–7.3): the "To review" list, pool reviews, the judge's decision
 * and handing a battle from level 1 to the pool.
 */
import { judgeDecisionSchema, reviewVoteSchema } from '@hfb/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { levelOneDisagrees } from '../battles/review';
import { getDb } from '../db/client';
import { battleParticipants, battles, reviewVotes, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { parseJson } from '../lib/validate';
import { requestNotifyContext } from '../services/notify';
import {
  escalate,
  notifyReviewers,
  reviewerRole,
  settleJudge,
  settlePool,
} from '../services/review';
import { battleResponse, loadBattle } from './battles';

/** Mounted at /api/reviews. */
export const reviewRoutes = new Hono<AppEnv>();
reviewRoutes.use(requireUser({ active: true }));

/** Mounted at /api/battles. */
export const reviewBattleRoutes = new Hono<AppEnv>();
reviewBattleRoutes.use(requireUser({ active: true }));

/**
 * Battles waiting for my review: pools I may join and have not reviewed yet, and – for judges –
 * battles at level 3. Oldest first.
 */
reviewRoutes.get('/open', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const waiting = await db
    .select()
    .from(battles)
    .where(and(eq(battles.status, 'reviewing'), inArray(battles.reviewLevel, [2, 3])))
    .orderBy(battles.reviewLevelSince)
    .limit(100);
  if (waiting.length === 0) return c.json({ reviews: [] });
  const ids = waiting.map((b) => b.id);
  const [participants, myVotes] = await Promise.all([
    db
      .select({
        battleId: battleParticipants.battleId,
        userId: users.id,
        displayName: users.displayName,
        seat: battleParticipants.seat,
      })
      .from(battleParticipants)
      .innerJoin(users, eq(users.id, battleParticipants.userId))
      .where(inArray(battleParticipants.battleId, ids)),
    db
      .select({ battleId: reviewVotes.battleId })
      .from(reviewVotes)
      .where(and(inArray(reviewVotes.battleId, ids), eq(reviewVotes.voterId, user.id))),
  ]);
  const reviews = [];
  for (const battle of waiting) {
    if (myVotes.some((v) => v.battleId === battle.id && battle.reviewLevel === 2)) continue;
    const people = participants
      .filter((p) => p.battleId === battle.id)
      .sort((a, b) => a.seat - b.seat);
    const role = await reviewerRole(
      db,
      battle,
      people.map((p) => p.userId),
      user.id,
      now,
    );
    if (!role) continue;
    reviews.push({
      battleId: battle.id,
      formatId: battle.formatId,
      level: battle.reviewLevel,
      since: battle.reviewLevelSince,
      participants: people.map(({ userId, displayName }) => ({ userId, displayName })),
    });
  }
  return c.json({ reviews });
});

/** Level 1 without agreement: a participant hands the battle to the pool right away. */
reviewBattleRoutes.post('/:id/escalate', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  if (!participants.some((p) => p.userId === user.id)) apiError(403, 'not_a_participant');
  if (battle.status !== 'reviewing' || battle.reviewLevel !== 1) apiError(409, 'not_in_review');
  const votes = await db
    .select({ value: reviewVotes.value })
    .from(reviewVotes)
    .where(and(eq(reviewVotes.battleId, battle.id), eq(reviewVotes.reviewLevel, 1)));
  if (!levelOneDisagrees(votes.map((v) => v.value))) apiError(409, 'no_disagreement');
  if (await escalate(db, battle, 2, now))
    await notifyReviewers(requestNotifyContext(c), battle.id, now);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/** Level 2: one review per pool member, blind and final. */
reviewBattleRoutes.post('/:id/pool-vote', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { value } = await parseJson(c, reviewVoteSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  if (battle.status !== 'reviewing' || battle.reviewLevel !== 2) apiError(409, 'not_in_review');
  const role = await reviewerRole(
    db,
    battle,
    participants.map((p) => p.userId),
    user.id,
    now,
  );
  if (role !== 'pool') apiError(403, 'not_a_reviewer');
  const inserted = await db
    .insert(reviewVotes)
    .values({ battleId: battle.id, voterId: user.id, reviewLevel: 2, value, createdAt: now })
    .onConflictDoNothing()
    .returning({ voterId: reviewVotes.voterId });
  if (inserted.length === 0) apiError(409, 'already_reviewed');
  if ((await settlePool(db, battle, now)) === 'judges')
    await notifyReviewers(requestNotifyContext(c), battle.id, now);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/** Level 3: the judge decides. Audited (special role). */
reviewBattleRoutes.post('/:id/judge-decision', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { value, note } = await parseJson(c, judgeDecisionSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  if (battle.status !== 'reviewing' || battle.reviewLevel !== 3) apiError(409, 'not_in_review');
  const role = await reviewerRole(
    db,
    battle,
    participants.map((p) => p.userId),
    user.id,
    now,
  );
  if (role !== 'judge') apiError(403, 'not_a_judge');
  await db.batch([
    db
      .insert(reviewVotes)
      .values({ battleId: battle.id, voterId: user.id, reviewLevel: 3, value, createdAt: now })
      .onConflictDoUpdate({
        target: [reviewVotes.battleId, reviewVotes.voterId, reviewVotes.reviewLevel],
        set: { value, createdAt: now },
      }),
    auditInsert(
      db,
      {
        actorId: user.id,
        action: 'review.judge_decision',
        targetType: 'battle',
        targetId: battle.id,
        reason: note || null,
        payload: { value },
      },
      now,
    ),
  ]);
  await settleJudge(db, battle, value, now);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});
