/**
 * Attempts, provisional attempts and reservations for offline recording (concept section 6,
 * decided 2026-10-12).
 *
 * - Recording is never blocked by the attempt limit; attempts beyond the allowance are kept but
 *   cannot be chosen (provisional). The rules live in `settleAttempts` (@hfb/shared); this file
 *   applies them to the stored attempts of one athlete.
 * - While online, a device can reserve attempts for recording offline. Reserved units use up the
 *   allowance at once, so deleting the app before reporting back cannot hide a bad attempt: the
 *   units stay used. Attempts recorded under the reservation fill its units ("covered", always
 *   valid). Reporting back hands the unused units back.
 * - With nothing free, another device can still reserve (a take-over, `count` 0): its attempts
 *   are provisional and become valid when the original device hands units back or the opponent
 *   grants extra attempts.
 */
import { attemptsLeft, type ReserveAttempts, settleAttempts, slotKey } from '@hfb/shared';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  attemptReservations,
  attempts,
  battleParticipants,
  battleProposals,
  battles,
  submissions,
  videos,
} from '../db/schema';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { eventStatement } from './battleEvents';

type BattleRow = typeof battles.$inferSelect;
type ReservationRow = typeof attemptReservations.$inferSelect;

/** The phone's clock may be a little ahead of or behind ours. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

/** Everything about one athlete's attempts in a battle that the allowance depends on. */
async function loadUsage(db: Database, battleId: string, userId: string) {
  const [rows, me, chosen, reservations] = await Promise.all([
    db
      .select({
        id: attempts.id,
        partIndex: attempts.partIndex,
        round: attempts.round,
        startedAt: attempts.startedAtClient,
        provisional: attempts.provisional,
        reservationId: attempts.reservationId,
      })
      .from(attempts)
      .where(and(eq(attempts.battleId, battleId), eq(attempts.userId, userId))),
    db
      .select({ extraAttempts: battleParticipants.extraAttempts })
      .from(battleParticipants)
      .where(and(eq(battleParticipants.battleId, battleId), eq(battleParticipants.userId, userId)))
      .get(),
    db
      .select({ attemptId: videos.attemptId })
      .from(submissions)
      .innerJoin(videos, eq(videos.id, submissions.videoId))
      .where(and(eq(submissions.battleId, battleId), eq(submissions.userId, userId))),
    db
      .select()
      .from(attemptReservations)
      .where(
        and(eq(attemptReservations.battleId, battleId), eq(attemptReservations.userId, userId)),
      ),
  ]);
  const reservedBySlot = new Map<string, number>();
  for (const r of reservations) {
    const key = slotKey(r.partIndex, r.round);
    reservedBySlot.set(key, (reservedBySlot.get(key) ?? 0) + r.count);
  }
  return {
    rows,
    extraAttempts: me?.extraAttempts ?? 0,
    submitted: new Set(chosen.map((c) => c.attemptId)),
    reservations,
    reservedBySlot,
  };
}

/** Units in use per slot: reserved units plus valid attempts outside reservations. */
function usedBySlot(usage: Awaited<ReturnType<typeof loadUsage>>) {
  const used = new Map(usage.reservedBySlot);
  for (const a of usage.rows) {
    if (a.provisional || a.reservationId !== null) continue;
    const key = slotKey(a.partIndex, a.round);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return used;
}

/**
 * Re-checks which of `userId`'s attempts in this battle are provisional. Call it after anything
 * that changes the allowance or the attempts: a new attempt, an extra attempt granted or taken
 * back, a reservation handed back. Returns how many attempts changed.
 */
export async function settleUserAttempts(
  db: Database,
  battle: Pick<BattleRow, 'id' | 'attemptsPerVideo'>,
  userId: string,
): Promise<number> {
  const usage = await loadUsage(db, battle.id, userId);
  const changes = settleAttempts(
    battle.attemptsPerVideo,
    usage.extraAttempts,
    usage.reservedBySlot,
    usage.rows.map((a) => ({
      id: a.id,
      slot: slotKey(a.partIndex, a.round),
      startedAt: a.startedAt,
      provisional: a.provisional,
      covered: a.reservationId !== null,
      submitted: usage.submitted.has(a.id),
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

/** Who records: the athlete's own device, or a friend with the athlete code. */
export interface Recorder {
  deviceCode: string | null;
  codeUsed: string | null;
  recorderName: string | null;
  recordedBy: string | null;
}

/**
 * Stores a new attempt (pressing Start). Inside a reservation of the same device with units
 * left, it is covered (always valid); otherwise it is settled like any attempt.
 * The caller has checked that the battle runs and the start is before the deadline.
 */
export async function insertAttempt(
  db: Database,
  battle: BattleRow,
  userId: string,
  input: {
    id: string;
    partIndex: number;
    round: number;
    startedAt: number;
    reservationId?: string | undefined;
  },
  recorder: Recorder,
  now: number,
) {
  let coveredBy: string | null = null;
  if (input.reservationId) {
    const reservation = await db
      .select()
      .from(attemptReservations)
      .where(eq(attemptReservations.id, input.reservationId))
      .get();
    if (
      !reservation ||
      reservation.battleId !== battle.id ||
      reservation.userId !== userId ||
      reservation.deviceCode !== recorder.deviceCode ||
      reservation.partIndex !== input.partIndex ||
      reservation.round !== input.round
    )
      apiError(409, 'reservation_mismatch');
    const used = await db
      .select({ n: count() })
      .from(attempts)
      .where(eq(attempts.reservationId, reservation.id))
      .get();
    if (
      reservation.closedAt === null &&
      (used?.n ?? 0) < reservation.count &&
      input.startedAt >= reservation.createdAt - CLOCK_TOLERANCE_MS
    )
      coveredBy = reservation.id;
  }
  await db.insert(attempts).values({
    id: input.id,
    battleId: battle.id,
    userId,
    partIndex: input.partIndex,
    round: input.round,
    startedAtClient: input.startedAt,
    syncedAt: now,
    recordedBy: recorder.recordedBy,
    codeUsed: recorder.codeUsed,
    recorderName: recorder.recorderName,
    assignment: recorder.codeUsed ? 'direct' : null,
    deviceCode: recorder.deviceCode,
    reservationId: coveredBy,
    provisional: coveredBy === null,
  });
  await settleUserAttempts(db, battle, userId);
}

/**
 * "Prepare for offline recording": reserves up to the requested number of attempts per part,
 * at most what is free. With nothing free the reservation still exists (count 0), so the device
 * may record offline; its attempts are provisional (a take-over if another device holds units).
 */
export async function reserveAttempts(
  db: Database,
  battle: BattleRow,
  userId: string,
  input: ReserveAttempts,
  recorder: Recorder,
  now: number,
) {
  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  if (battle.deadlineAt !== null && battle.deadlineAt <= now) apiError(409, 'deadline_passed');
  const usage = await loadUsage(db, battle.id, userId);
  const used = usedBySlot(usage);
  const othersOpen = usage.reservations.filter(
    (r) => r.closedAt === null && r.deviceCode !== recorder.deviceCode,
  );
  const rows: ReservationRow[] = [];
  for (const part of input.parts) {
    const slot = slotKey(part.partIndex, part.round);
    const free = attemptsLeft(battle.attemptsPerVideo, usage.extraAttempts, used, slot);
    const units = free === null ? 0 : Math.min(part.count, free);
    used.set(slot, (used.get(slot) ?? 0) + units);
    rows.push({
      id: newId(now),
      battleId: battle.id,
      userId,
      partIndex: part.partIndex,
      round: part.round,
      count: units,
      requested: part.count,
      deviceCode: recorder.deviceCode ?? '',
      takeover:
        free !== null &&
        units < part.count &&
        othersOpen.some((r) => r.partIndex === part.partIndex && r.round === part.round),
      codeUsed: recorder.codeUsed,
      recorderName: recorder.recorderName,
      createdAt: now,
      reportedAt: null,
      closedAt: null,
    });
  }
  const [first, ...rest] = rows;
  if (!first) return [];
  await db.batch([
    db.insert(attemptReservations).values(first),
    ...rest.map((r) => db.insert(attemptReservations).values(r)),
    ...rows.map((r, i) =>
      eventStatement(
        db,
        battle.id,
        userId,
        {
          type: 'reserved',
          partIndex: r.partIndex,
          count: r.count,
          requested: r.requested,
          takeover: r.takeover,
          friend: r.codeUsed ? (r.recorderName ?? '') : null,
        },
        now + i,
      ),
    ),
  ]);
  return rows;
}

/**
 * The device is back online and has registered its attempts. With `handBack` (or once the
 * deadline passed, or the battle no longer runs) the unused units are free again.
 */
export async function reportReservation(
  db: Database,
  battle: BattleRow,
  reservation: ReservationRow,
  handBack: boolean,
  now: number,
) {
  if (reservation.closedAt !== null) return reservation;
  const close =
    handBack ||
    battle.status !== 'active' ||
    (battle.deadlineAt !== null && battle.deadlineAt <= now);
  const used = await db
    .select({ n: count() })
    .from(attempts)
    .where(eq(attempts.reservationId, reservation.id))
    .get();
  const n = used?.n ?? 0;
  const update = close
    ? { reportedAt: now, closedAt: now, count: Math.min(reservation.count, n) }
    : { reportedAt: now };
  // Only the first report and the hand-back go into the chat (later ones change nothing visible).
  const tell = close || reservation.reportedAt === null;
  await db.batch([
    db.update(attemptReservations).set(update).where(eq(attemptReservations.id, reservation.id)),
    ...(tell
      ? [
          eventStatement(
            db,
            battle.id,
            reservation.userId,
            {
              type: 'reservation_reported',
              partIndex: reservation.partIndex,
              used: n,
              handedBack: close ? Math.max(0, reservation.count - n) : 0,
              closed: close,
            },
            now,
          ),
        ]
      : []),
  ]);
  if (close) await settleUserAttempts(db, battle, reservation.userId);
  return { ...reservation, ...update };
}

/** A reservation of this battle, athlete and device, or a 404. */
export async function ownReservation(
  db: Database,
  battleId: string,
  reservationId: string,
  userId: string,
  deviceCode: string,
) {
  const reservation = await db
    .select()
    .from(attemptReservations)
    .where(eq(attemptReservations.id, reservationId))
    .get();
  if (
    !reservation ||
    reservation.battleId !== battleId ||
    reservation.userId !== userId ||
    reservation.deviceCode !== deviceCode
  )
    apiError(404, 'not_found');
  return reservation;
}

/** The battle's reservations, oldest first (for the battle view). */
export function battleReservations(db: Database, battleId: string) {
  return db
    .select()
    .from(attemptReservations)
    .where(eq(attemptReservations.battleId, battleId))
    .orderBy(attemptReservations.createdAt);
}

/**
 * Reservations never reported back (concept section 6: a lost device, e.g. the app deleted):
 * still open when the battle no longer ran. They only count where the athlete then asked for
 * extra attempts in the same battle (owner, 2026-10-13): whoever accepts the loss is not
 * suspicious. Per battle: min(reserved attempts never reported, extra attempts requested).
 * Summed per athlete, shown to opponents next to extra-attempt requests and to the federation
 * and admins.
 */
export async function lostReservations(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;
  const open = await db
    .select({
      id: attemptReservations.id,
      battleId: attemptReservations.battleId,
      userId: attemptReservations.userId,
      count: attemptReservations.count,
    })
    .from(attemptReservations)
    .innerJoin(battles, eq(battles.id, attemptReservations.battleId))
    .where(
      and(
        inArray(attemptReservations.userId, [...userIds]),
        isNull(attemptReservations.closedAt),
        ne(battles.status, 'active'),
      ),
    )
    // D1 allows at most 100 bound parameters per query (the ids below).
    .limit(40);
  if (open.length === 0) return result;
  const battleIds = [...new Set(open.map((r) => r.battleId))];
  const [covered, requests] = await Promise.all([
    db
      .select({ reservationId: attempts.reservationId, n: count() })
      .from(attempts)
      .where(
        inArray(
          attempts.reservationId,
          open.map((r) => r.id),
        ),
      )
      .groupBy(attempts.reservationId),
    db
      .select({
        battleId: battleProposals.battleId,
        proposedBy: battleProposals.proposedBy,
        payloadJson: battleProposals.payloadJson,
      })
      .from(battleProposals)
      .where(
        and(
          inArray(battleProposals.battleId, battleIds),
          eq(battleProposals.kind, 'extra_attempt'),
          // A request replaced by a new one is not counted twice.
          ne(battleProposals.status, 'withdrawn'),
        ),
      ),
  ]);
  const key = (userId: string, battleId: string) => `${userId}:${battleId}`;
  const unreported = new Map<string, number>();
  for (const r of open) {
    const used = covered.find((c) => c.reservationId === r.id)?.n ?? 0;
    const k = key(r.userId, r.battleId);
    unreported.set(k, (unreported.get(k) ?? 0) + Math.max(0, r.count - used));
  }
  const asked = new Map<string, number>();
  for (const p of requests) {
    if ((JSON.parse(p.payloadJson) as { change?: number }).change !== 1) continue;
    const k = key(p.proposedBy, p.battleId);
    asked.set(k, (asked.get(k) ?? 0) + 1);
  }
  for (const [k, n] of unreported) {
    const lost = Math.min(n, asked.get(k) ?? 0);
    if (lost === 0) continue;
    const userId = k.slice(0, k.indexOf(':'));
    result.set(userId, (result.get(userId) ?? 0) + lost);
  }
  return result;
}

/**
 * During the grace period after the deadline (UPLOAD_GRACE_DAYS), may these athletes still
 * deliver? Yes if they hold reserved units not reported back or valid attempts they could
 * still upload and choose.
 */
export async function mayStillDeliver(
  db: Database,
  battleId: string,
  userIds: readonly string[],
): Promise<boolean> {
  if (userIds.length === 0) return false;
  const [open, valid] = await Promise.all([
    db
      .select({ n: count() })
      .from(attemptReservations)
      .where(
        and(
          eq(attemptReservations.battleId, battleId),
          inArray(attemptReservations.userId, [...userIds]),
          isNull(attemptReservations.closedAt),
        ),
      )
      .get(),
    db
      .select({ n: count() })
      .from(attempts)
      .where(
        and(
          eq(attempts.battleId, battleId),
          inArray(attempts.userId, [...userIds]),
          eq(attempts.provisional, false),
        ),
      )
      .get(),
  ]);
  return (open?.n ?? 0) > 0 || (valid?.n ?? 0) > 0;
}
