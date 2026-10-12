/**
 * Review: votes → result → rating (concept section 7).
 *
 * - Level 1: both athletes (step 9). Without agreement either of them can hand the battle to the
 *   pool; when the review time is over, two votes without agreement go to the pool as well.
 * - Level 2: three athletes with a similar or higher rating (`poolWindow`) review blind; if they
 *   do not contradict each other, they decide, otherwise (or if the pool is not full after
 *   `poolMaxDays`) a judge does.
 * - Level 3: one judge decides (owner, 2026-10-12).
 * Shared by the vote routes and the scheduled job.
 */
import { REVIEW_DAYS, reviewParams } from '@hfb/shared';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import {
  levelOneDisagrees,
  poolOutcome,
  poolWindow,
  reviewOutcome,
  voteScore,
} from '../battles/review';
import { type Database, runBatch } from '../db/client';
import {
  battleParticipants,
  battles,
  formats,
  ratingStates,
  reviewVotes,
  userRoles,
} from '../db/schema';
import { cancelStatements, decideStatements } from './battles';
import { displayParams } from './ratingView';

type BattleRow = typeof battles.$inferSelect;

const DAY = 86_400_000;

/** When the review of level 1 closes (null before the videos unlock). */
export function reviewEndsAt(battle: Pick<BattleRow, 'playedAt'>): number | null {
  return battle.playedAt === null ? null : battle.playedAt + REVIEW_DAYS * DAY;
}

async function votesOf(db: Database, battleId: string, level: number) {
  return db
    .select({ userId: reviewVotes.voterId, value: reviewVotes.value })
    .from(reviewVotes)
    .where(and(eq(reviewVotes.battleId, battleId), eq(reviewVotes.reviewLevel, level)));
}

async function seatOrder(db: Database, battleId: string) {
  return (
    await db
      .select({ userId: battleParticipants.userId })
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, battleId))
      .orderBy(battleParticipants.seat)
  ).map((p) => p.userId);
}

// ---------------------------------------------------------------------------------------------
// Who reviews
// ---------------------------------------------------------------------------------------------

/**
 * The pool's rating range for a battle now: R_high is the higher participant rating in the
 * battle's rating format (the default rating for someone without one).
 */
async function poolRange(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  now: number,
) {
  const params = await displayParams(db);
  const review = reviewParams(params);
  const format = await db
    .select({ mergedInto: formats.mergedInto })
    .from(formats)
    .where(eq(formats.id, battle.formatId))
    .get();
  const formatId = format?.mergedInto ?? battle.formatId;
  const states = participantIds.length
    ? await db
        .select({ userId: ratingStates.userId, r: ratingStates.r })
        .from(ratingStates)
        .where(
          and(
            eq(ratingStates.formatId, formatId),
            inArray(ratingStates.userId, [...participantIds]),
          ),
        )
    : [];
  const rHigh = Math.max(
    ...participantIds.map((id) => states.find((s) => s.userId === id)?.r ?? params.rDefault),
  );
  return {
    formatId,
    review,
    window: poolWindow(rHigh, battle.reviewLevelSince ?? now, now, review),
  };
}

/**
 * What the viewer may do in this battle's review: `pool` (eligible pool reviewer at level 2),
 * `judge` (level 3) or null. Participants never review their own battle.
 */
export async function reviewerRole(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  viewerId: string | null,
  now = Date.now(),
): Promise<'pool' | 'judge' | null> {
  if (!viewerId || battle.status !== 'reviewing' || participantIds.includes(viewerId)) return null;
  if (battle.reviewLevel === 3) {
    const judge = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, viewerId),
          eq(userRoles.role, 'judge'),
          isNull(userRoles.revokedAt),
        ),
      )
      .get();
    return judge ? 'judge' : null;
  }
  if (battle.reviewLevel !== 2) return null;
  const { formatId, review, window } = await poolRange(db, battle, participantIds, now);
  const mine = await db
    .select({ r: ratingStates.r, nBattles: ratingStates.nBattles })
    .from(ratingStates)
    .where(and(eq(ratingStates.userId, viewerId), eq(ratingStates.formatId, formatId)))
    .get();
  if (!mine || mine.nBattles < review.poolMinBattles) return null;
  const inRange = mine.r >= window.min && (window.max === null || mine.r <= window.max);
  return inRange ? 'pool' : null;
}

// ---------------------------------------------------------------------------------------------
// Battle response
// ---------------------------------------------------------------------------------------------

/**
 * Review part of the battle response. Level 1 votes stay hidden until both have voted
 * (concept 7.1); the viewer always sees their own. Pool reviews are blind: participants and
 * reviewers see how many there are, judges see all earlier votes (Claude's default).
 */
export async function reviewView(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  viewerId: string | null,
) {
  if (battle.status !== 'reviewing' && battle.status !== 'decided') return null;
  const [votes, pool, judge] = await Promise.all([
    votesOf(db, battle.id, 1),
    votesOf(db, battle.id, 2),
    votesOf(db, battle.id, 3),
  ]);
  if (battle.status === 'decided' && votes.length === 0 && pool.length === 0) return null;
  const allVoted = participantIds.every((id) => votes.some((v) => v.userId === id));
  const role = await reviewerRole(db, battle, participantIds, viewerId);
  const params = reviewParams(await displayParams(db));
  return {
    level: battle.reviewLevel,
    levelSince: battle.reviewLevelSince,
    endsAt: reviewEndsAt(battle),
    voted: votes.map((v) => v.userId),
    votes:
      role === 'judge'
        ? votes
        : votes.filter((v) => allVoted || battle.status === 'decided' || v.userId === viewerId),
    canEscalate:
      battle.status === 'reviewing' &&
      battle.reviewLevel === 1 &&
      viewerId !== null &&
      participantIds.includes(viewerId) &&
      levelOneDisagrees(votes.map((v) => v.value)),
    poolSize: params.poolSize,
    poolCount: pool.length,
    poolVotes: role === 'judge' ? pool.map((v) => v.value) : null,
    myPoolVote: pool.find((v) => v.userId === viewerId)?.value ?? null,
    judged: judge.length > 0,
    reviewerRole: role,
  };
}

// ---------------------------------------------------------------------------------------------
// Moving on and deciding
// ---------------------------------------------------------------------------------------------

/** Hand the battle to the next review level (2 = pool, 3 = judges). */
export async function escalate(db: Database, battle: BattleRow, to: 2 | 3, now: number) {
  const moved = await db
    .update(battles)
    .set({ reviewLevel: to, reviewLevelSince: now })
    .where(
      and(
        eq(battles.id, battle.id),
        eq(battles.status, 'reviewing'),
        eq(battles.reviewLevel, to - 1),
      ),
    )
    .returning({ id: battles.id });
  return moved.length > 0;
}

/** Decide with s of seat 0; only the request that moves the battle out of `reviewing` rates it. */
async function decide(db: Database, battle: BattleRow, seat0Score: number, now: number) {
  const claimed = await db
    .update(battles)
    .set({ status: 'decided' })
    .where(and(eq(battles.id, battle.id), eq(battles.status, 'reviewing')))
    .returning({ id: battles.id });
  if (claimed.length === 0) return false;
  const [first, second, ...rest] = await seatOrder(db, battle.id);
  if (!first || !second || rest.length > 0) throw new Error('Review needs two people');
  const results = [
    { userId: first, score: seat0Score },
    { userId: second, score: 1 - seat0Score },
  ];
  try {
    await runBatch(db, await decideStatements(db, battle, results, 'review', now));
  } catch (error) {
    await db.update(battles).set({ status: 'reviewing' }).where(eq(battles.id, battle.id));
    throw error;
  }
  return true;
}

/**
 * Level 1: decides the battle if the votes allow it. `closed` = the review time is over
 * (scheduled job). Returns what happened.
 */
export async function settleReview(
  db: Database,
  battle: BattleRow,
  now: number,
  closed: boolean,
): Promise<'decided' | 'open' | 'no_agreement' | 'pool'> {
  const votes = (await votesOf(db, battle.id, 1)).map((v) => v.value);
  const outcome = reviewOutcome(votes, battle.scoring, closed);
  if (outcome.kind === 'open') return 'open';
  if (outcome.kind === 'decided')
    return (await decide(db, battle, outcome.seat0Score, now)) ? 'decided' : 'open';
  // Both voted without agreement: the pool takes over (stage 2) instead of ending unrated.
  if (levelOneDisagrees(votes)) return (await escalate(db, battle, 2, now)) ? 'pool' : 'open';
  const claimed = await db
    .update(battles)
    .set({ status: 'cancelled' })
    .where(and(eq(battles.id, battle.id), eq(battles.status, 'reviewing')))
    .returning({ id: battles.id });
  if (claimed.length === 0) return 'open';
  await runBatch(db, cancelStatements(db, battle.id, 'no_agreement', now));
  return 'no_agreement';
}

/** Level 2: once the pool is full, it decides or hands the battle to the judges. */
export async function settlePool(db: Database, battle: BattleRow, now: number) {
  const { poolSize } = reviewParams(await displayParams(db));
  const votes = (await votesOf(db, battle.id, 2)).map((v) => v.value);
  const outcome = poolOutcome(votes, battle.scoring, poolSize);
  if (outcome.kind === 'open') return 'open';
  if (outcome.kind === 'judges') return (await escalate(db, battle, 3, now)) ? 'judges' : 'open';
  return (await decide(db, battle, outcome.seat0Score, now)) ? 'decided' : 'open';
}

/** Level 3: the judge's decision. */
export async function settleJudge(db: Database, battle: BattleRow, value: number, now: number) {
  return decide(db, battle, voteScore(value, battle.scoring), now);
}

/**
 * Scheduled job: level 1 reviews whose time is over (a single vote for one side decides, two
 * votes without agreement go to the pool, otherwise unrated) and pools that did not fill up in
 * time (→ judges). Returns how many battles were settled or moved on.
 */
export async function resolveExpiredReviews(db: Database, now = Date.now()): Promise<number> {
  const due = await db
    .select()
    .from(battles)
    .where(
      and(
        eq(battles.status, 'reviewing'),
        eq(battles.reviewLevel, 1),
        lt(battles.playedAt, now - REVIEW_DAYS * DAY),
      ),
    )
    .limit(50);
  for (const battle of due) await settleReview(db, battle, now, true);

  const { poolMaxDays } = reviewParams(await displayParams(db));
  const stalePools = await db
    .select()
    .from(battles)
    .where(
      and(
        eq(battles.status, 'reviewing'),
        eq(battles.reviewLevel, 2),
        lt(battles.reviewLevelSince, now - poolMaxDays * DAY),
      ),
    )
    .limit(50);
  for (const battle of stalePools) await escalate(db, battle, 3, now);
  return due.length + stalePools.length;
}
