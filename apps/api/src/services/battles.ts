/**
 * Ending battles: shared by the API routes and the scheduled job.
 */
import { AUTO_DECIDE_AFTER_DAYS } from '@hfb/shared';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { deliveryStatus, winnerScores } from '../battles/rules';
import { type Database, runBatch } from '../db/client';
import {
  battleParticipants,
  battleProposals,
  battles,
  formatVersions,
  submissions,
} from '../db/schema';
import { ratingStatements } from './rating';

type BattleRow = typeof battles.$inferSelect;

/** Statements that decide a battle with the given scores and update the ratings. */
export async function decideStatements(
  db: Database,
  battle: BattleRow,
  results: { userId: string; score: number }[],
  reason: 'forfeit' | 'deadline' | 'review',
  now: number,
): Promise<BatchItem<'sqlite'>[]> {
  return [
    db
      .update(battles)
      .set({ status: 'decided', decidedAt: now, eventAt: now, decisionReason: reason })
      .where(eq(battles.id, battle.id)),
    ...results.map((r) =>
      db
        .update(battleParticipants)
        .set({ score: r.score })
        .where(
          and(eq(battleParticipants.battleId, battle.id), eq(battleParticipants.userId, r.userId)),
        ),
    ),
    ...(await ratingStatements(
      db,
      {
        id: battle.id,
        formatId: battle.formatId,
        level: battle.level,
        rulesetVersion: battle.rulesetVersion,
        results,
      },
      now,
    )),
  ];
}

/** Statements that end a battle without rating; pending proposals are withdrawn. */
export function cancelStatements(
  db: Database,
  battleId: string,
  reason: string,
  now = Date.now(),
): BatchItem<'sqlite'>[] {
  return [
    db
      .update(battles)
      .set({ status: 'cancelled', cancelReason: reason })
      .where(eq(battles.id, battleId)),
    cancelPendingProposalsStatement(db, battleId, now),
  ];
}

/** Withdraws every pending proposal of a battle (it ended or moved on). */
export function cancelPendingProposalsStatement(db: Database, battleId: string, now: number) {
  return db
    .update(battleProposals)
    .set({ status: 'withdrawn', resolvedAt: now })
    .where(and(eq(battleProposals.battleId, battleId), eq(battleProposals.status, 'pending')));
}

/** Videos each person must submit: one per part of the format version and per round. */
export async function requiredSubmissionsPerPerson(
  db: Database,
  battle: BattleRow,
): Promise<number> {
  const row = await db
    .select({ partsJson: formatVersions.partsJson })
    .from(formatVersions)
    .where(
      and(
        eq(formatVersions.formatId, battle.formatId),
        eq(formatVersions.version, battle.formatVersion),
      ),
    )
    .get();
  if (!row) throw new Error(`Format version missing for battle ${battle.id}`);
  return (JSON.parse(row.partsJson) as unknown[]).length * battle.rounds;
}

/**
 * Scheduled job: battles whose deadline passed more than AUTO_DECIDE_AFTER_DAYS ago without a
 * decision. One side delivered → it wins; nobody delivered → cancelled unrated.
 * Returns how many battles were resolved.
 */
export async function resolveAbandonedDeadlines(db: Database, now = Date.now()): Promise<number> {
  // Requests nobody accepted (or agreed on) before their deadline simply expire.
  await db
    .update(battles)
    .set({ status: 'cancelled', cancelReason: 'expired' })
    .where(and(inArray(battles.status, ['open', 'negotiating']), lt(battles.deadlineAt, now)));

  const cutoff = now - AUTO_DECIDE_AFTER_DAYS * 86_400_000;
  const due = await db
    .select()
    .from(battles)
    .where(and(eq(battles.status, 'active'), lt(battles.deadlineAt, cutoff)))
    .limit(50);
  if (due.length === 0) return 0;

  const participants = await db
    .select({
      battleId: battleParticipants.battleId,
      userId: battleParticipants.userId,
      seat: battleParticipants.seat,
    })
    .from(battleParticipants)
    .where(
      inArray(
        battleParticipants.battleId,
        due.map((b) => b.id),
      ),
    )
    .orderBy(battleParticipants.seat);
  const subs = await db
    .select({ battleId: submissions.battleId, userId: submissions.userId })
    .from(submissions)
    .where(
      inArray(
        submissions.battleId,
        due.map((b) => b.id),
      ),
    );

  let resolved = 0;
  for (const battle of due) {
    const seatOrder = participants.filter((p) => p.battleId === battle.id).map((p) => p.userId);
    const required = await requiredSubmissionsPerPerson(db, battle);
    const { delivered, missing } = deliveryStatus(
      seatOrder,
      subs.filter((s) => s.battleId === battle.id),
      required,
    );
    // Everyone delivered: the review phase handles it, not this job.
    if (missing.length === 0) continue;
    const winner = delivered.length === 1 && seatOrder.length === 2 ? delivered[0] : undefined;
    const statements = winner
      ? await decideStatements(db, battle, winnerScores(seatOrder, winner), 'deadline', now)
      : cancelStatements(db, battle.id, 'deadline_missed', now);
    await runBatch(db, statements);
    resolved++;
  }
  return resolved;
}
