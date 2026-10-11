/**
 * Pure rules of the battle flow (concept section 5), without database access.
 */
import type { BattleSettings } from '@hfb/shared';
import type { battles } from '../db/schema';

type BattleRow = typeof battles.$inferSelect;

export function settingsOf(battle: BattleRow): BattleSettings {
  return {
    attemptsPerVideo: battle.attemptsPerVideo as BattleSettings['attemptsPerVideo'],
    deadlineAt: battle.deadlineAt,
    level: battle.level,
    scoring: battle.scoring as BattleSettings['scoring'],
    reviewMode: battle.reviewMode as BattleSettings['reviewMode'],
  };
}

/**
 * Deadline of a battle that starts now. Deadlines are fixed dates; battles created before that
 * change only stored a time window (`time_window_hours`), counted from the start.
 */
export function effectiveDeadline(
  battle: Pick<BattleRow, 'deadlineAt' | 'timeWindowHours'>,
  start: number,
): number | null {
  if (battle.deadlineAt !== null) return battle.deadlineAt;
  return battle.timeWindowHours === null ? null : start + battle.timeWindowHours * 3_600_000;
}

export function isDeadlinePassed(battle: Pick<BattleRow, 'deadlineAt'>, now: number): boolean {
  return battle.deadlineAt !== null && battle.deadlineAt <= now;
}

/**
 * Who has submitted all videos. Each person needs one submission per part and round.
 */
export function deliveryStatus(
  participantIds: readonly string[],
  submissions: readonly { userId: string }[],
  requiredPerPerson: number,
): { delivered: string[]; missing: string[] } {
  const count = new Map<string, number>();
  for (const s of submissions) count.set(s.userId, (count.get(s.userId) ?? 0) + 1);
  const delivered = participantIds.filter((id) => (count.get(id) ?? 0) >= requiredPerPerson);
  return { delivered, missing: participantIds.filter((id) => !delivered.includes(id)) };
}

/** Scores in seat order when `winnerId` wins outright (forfeit, missed deadline). */
export function winnerScores(seatOrder: readonly string[], winnerId: string) {
  return seatOrder.map((userId) => ({ userId, score: userId === winnerId ? 1 : 0 }));
}
