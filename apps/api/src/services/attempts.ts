/**
 * Provisional attempts (concept section 6, decided 2026-10-12): recording is never blocked by
 * the attempt limit; attempts beyond the allowance are kept but cannot be chosen. The rules live
 * in `settleAttempts` (@hfb/shared); this applies them to the stored attempts of one athlete.
 */
import { settleAttempts, slotKey } from '@hfb/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { attempts, battleParticipants, type battles, submissions, videos } from '../db/schema';

type BattleRow = typeof battles.$inferSelect;

/**
 * Re-checks which of `userId`'s attempts in this battle are provisional. Call it after anything
 * that changes the allowance or the attempts: a new attempt, an extra attempt granted or taken
 * back. Returns how many attempts changed.
 */
export async function settleUserAttempts(
  db: Database,
  battle: Pick<BattleRow, 'id' | 'attemptsPerVideo'>,
  userId: string,
): Promise<number> {
  const [rows, me, chosen] = await Promise.all([
    db
      .select({
        id: attempts.id,
        partIndex: attempts.partIndex,
        round: attempts.round,
        startedAt: attempts.startedAtClient,
        provisional: attempts.provisional,
      })
      .from(attempts)
      .where(and(eq(attempts.battleId, battle.id), eq(attempts.userId, userId))),
    db
      .select({ extraAttempts: battleParticipants.extraAttempts })
      .from(battleParticipants)
      .where(and(eq(battleParticipants.battleId, battle.id), eq(battleParticipants.userId, userId)))
      .get(),
    db
      .select({ attemptId: videos.attemptId })
      .from(submissions)
      .innerJoin(videos, eq(videos.id, submissions.videoId))
      .where(and(eq(submissions.battleId, battle.id), eq(submissions.userId, userId))),
  ]);
  const submitted = new Set(chosen.map((c) => c.attemptId));
  const changes = settleAttempts(
    battle.attemptsPerVideo,
    me?.extraAttempts ?? 0,
    new Map(),
    rows.map((a) => ({
      id: a.id,
      slot: slotKey(a.partIndex, a.round),
      startedAt: a.startedAt,
      provisional: a.provisional,
      covered: false,
      submitted: submitted.has(a.id),
    })),
  );
  const toValid = [...changes].filter(([, p]) => !p).map(([id]) => id);
  const toProvisional = [...changes].filter(([, p]) => p).map(([id]) => id);
  const statements = [
    ...(toValid.length > 0
      ? [db.update(attempts).set({ provisional: false }).where(inArray(attempts.id, toValid))]
      : []),
    ...(toProvisional.length > 0
      ? [db.update(attempts).set({ provisional: true }).where(inArray(attempts.id, toProvisional))]
      : []),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return changes.size;
}
