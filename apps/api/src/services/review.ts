/**
 * Review level 1: votes of the two athletes → result → rating (concept section 7, step 9).
 * Shared by the vote route and the scheduled job.
 */
import { REVIEW_DAYS } from '@hfb/shared';
import { and, eq, lt } from 'drizzle-orm';
import { reviewOutcome } from '../battles/review';
import { type Database, runBatch } from '../db/client';
import { battleParticipants, battles, reviewVotes } from '../db/schema';
import { cancelStatements, decideStatements } from './battles';

type BattleRow = typeof battles.$inferSelect;

const DAY = 86_400_000;

/** When the review of level 1 closes (null before the videos unlock). */
export function reviewEndsAt(battle: Pick<BattleRow, 'playedAt'>): number | null {
  return battle.playedAt === null ? null : battle.playedAt + REVIEW_DAYS * DAY;
}

async function levelOneVotes(db: Database, battleId: string) {
  return db
    .select({ userId: reviewVotes.voterId, value: reviewVotes.value })
    .from(reviewVotes)
    .where(and(eq(reviewVotes.battleId, battleId), eq(reviewVotes.reviewLevel, 1)));
}

/**
 * Review part of the battle response. Every vote stays hidden until both have voted
 * (concept 7.1); the viewer always sees their own.
 */
export async function reviewView(
  db: Database,
  battle: BattleRow,
  participantIds: readonly string[],
  viewerId: string | null,
) {
  if (battle.status !== 'reviewing' && battle.status !== 'decided') return null;
  const votes = await levelOneVotes(db, battle.id);
  if (battle.status === 'decided' && votes.length === 0) return null;
  const allVoted = participantIds.every((id) => votes.some((v) => v.userId === id));
  return {
    level: battle.reviewLevel,
    endsAt: reviewEndsAt(battle),
    voted: votes.map((v) => v.userId),
    votes: votes.filter((v) => allVoted || battle.status === 'decided' || v.userId === viewerId),
  };
}

/**
 * Decides the battle if the votes allow it. `closed` = the review time is over (scheduled job).
 * Returns what happened.
 */
export async function settleReview(
  db: Database,
  battle: BattleRow,
  now: number,
  closed: boolean,
): Promise<'decided' | 'open' | 'no_agreement'> {
  const seatOrder = (
    await db
      .select({ userId: battleParticipants.userId })
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, battle.id))
      .orderBy(battleParticipants.seat)
  ).map((p) => p.userId);
  const votes = await levelOneVotes(db, battle.id);
  const outcome = reviewOutcome(
    votes.map((v) => v.value),
    battle.scoring,
    closed,
  );
  if (outcome.kind === 'open') return 'open';
  // Two votes arriving at the same moment must not decide (and rate) the battle twice: only the
  // request that moves it out of `reviewing` goes on.
  const claimed = await db
    .update(battles)
    .set({ status: outcome.kind === 'decided' ? 'decided' : 'cancelled' })
    .where(and(eq(battles.id, battle.id), eq(battles.status, 'reviewing')))
    .returning({ id: battles.id });
  if (claimed.length === 0) return 'open';
  if (outcome.kind === 'no_agreement') {
    await runBatch(db, cancelStatements(db, battle.id, 'no_agreement', now));
    return 'no_agreement';
  }
  const [first, second] = seatOrder;
  if (!first || !second || seatOrder.length !== 2) throw new Error('Review needs two people');
  const results = [
    { userId: first, score: outcome.seat0Score },
    { userId: second, score: 1 - outcome.seat0Score },
  ];
  try {
    await runBatch(db, await decideStatements(db, battle, results, 'review', now));
  } catch (error) {
    await db.update(battles).set({ status: 'reviewing' }).where(eq(battles.id, battle.id));
    throw error;
  }
  return 'decided';
}

/**
 * Scheduled job: reviews whose time is over. A single vote for one side decides; otherwise the
 * battle ends unrated. Returns how many battles were settled.
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
  return due.length;
}
