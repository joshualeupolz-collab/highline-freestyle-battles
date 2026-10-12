/**
 * Filming by friends (concept section 6, stage 2 plan §3.7). Whoever knows an athlete's code
 * can film attempts for them without an account:
 *
 * - online, the friend picks one of the athlete's running battles before recording – the attempt
 *   belongs to that battle at once (`assignment = 'direct'`);
 * - offline, the friend writes a short description; the video goes to the athlete's inbox
 *   (`attempts.battle_id` NULL). Later the friend or the athlete assigns it to a battle that was
 *   running at the recording time (`pending`), and the opponent confirms it (`confirmed`) or
 *   rejects it (back to the inbox).
 *
 * The attempts belong to the athlete (`user_id`); `code_used` and `recorder_name` say who filmed.
 */
import {
  ATHLETE_CODE_ALPHABET,
  ATHLETE_CODE_LENGTH,
  attemptsLeft,
  type CreateVideo,
  slotKey,
} from '@hfb/shared';
import { and, eq, gte, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  attempts,
  battleParticipants,
  battles,
  formats,
  formatVersions,
  users,
  videoFiles,
  videos,
} from '../db/schema';
import type { Env } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { originalKey, videoStore } from '../storage/videoStore';
import { requiredSubmissionsPerPerson } from './battles';

type BattleRow = typeof battles.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;

/** The phone's clock may be a little ahead of ours. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ATHLETE_CODE_LENGTH));
  // 256 is not a multiple of 31: the first characters are very slightly more likely. Irrelevant
  // for a code that only needs to be hard to guess, not perfectly uniform.
  return [...bytes].map((b) => ATHLETE_CODE_ALPHABET[b % ATHLETE_CODE_ALPHABET.length]).join('');
}

/** The athlete's code; created on first use. With `renew`, a new one replaces it. */
export async function athleteCode(db: Database, userId: string, renew = false): Promise<string> {
  if (!renew) {
    const row = await db
      .select({ code: users.athleteCode })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (row?.code) return row.code;
  }
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      await db.update(users).set({ athleteCode: code }).where(eq(users.id, userId));
      return code;
    } catch (err) {
      if (!String(err).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('No free athlete code found');
}

/** The active athlete with this code (already normalized), or a 404. */
export async function athleteByCode(db: Database, code: string) {
  const athlete = await db
    .select({ id: users.id, displayName: users.displayName, status: users.status })
    .from(users)
    .where(and(eq(users.athleteCode, code), isNull(users.deletedAt)))
    .get();
  if (athlete?.status !== 'active') apiError(404, 'unknown_code');
  return athlete;
}

/**
 * The athlete's battles that were running at `at`: accepted by then, deadline not passed by
 * then, and still running now (only those can still take a video).
 */
export async function battlesRunningAt(db: Database, athleteId: string, at: number) {
  const mine = db
    .select({ id: battleParticipants.battleId })
    .from(battleParticipants)
    .where(eq(battleParticipants.userId, athleteId));
  const rows = await db
    .select({ battle: battles, formatName: formats.name, partsJson: formatVersions.partsJson })
    .from(battles)
    .innerJoin(formats, eq(formats.id, battles.formatId))
    .innerJoin(
      formatVersions,
      and(
        eq(formatVersions.formatId, battles.formatId),
        eq(formatVersions.version, battles.formatVersion),
      ),
    )
    .where(
      and(
        inArray(battles.id, mine),
        eq(battles.status, 'active'),
        lte(battles.acceptedAt, at),
        or(isNull(battles.deadlineAt), gte(battles.deadlineAt, at)),
      ),
    )
    .limit(30);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.battle.id);
  const [people, used] = await Promise.all([
    db
      .select({
        battleId: battleParticipants.battleId,
        userId: battleParticipants.userId,
        extraAttempts: battleParticipants.extraAttempts,
        displayName: users.displayName,
      })
      .from(battleParticipants)
      .innerJoin(users, eq(users.id, battleParticipants.userId))
      .where(inArray(battleParticipants.battleId, ids)),
    db
      .select({ battleId: attempts.battleId, partIndex: attempts.partIndex, round: attempts.round })
      .from(attempts)
      .where(and(inArray(attempts.battleId, ids), eq(attempts.userId, athleteId))),
  ]);
  return rows.map(({ battle, formatName, partsJson }) => {
    const parts = JSON.parse(partsJson) as unknown[];
    const usedBySlot = new Map<string, number>();
    for (const a of used.filter((u) => u.battleId === battle.id)) {
      const key = slotKey(a.partIndex, a.round);
      usedBySlot.set(key, (usedBySlot.get(key) ?? 0) + 1);
    }
    const me = people.find((p) => p.battleId === battle.id && p.userId === athleteId);
    return {
      id: battle.id,
      formatName,
      parts,
      opponents: people
        .filter((p) => p.battleId === battle.id && p.userId !== athleteId)
        .map((p) => p.displayName),
      deadlineAt: battle.deadlineAt,
      attemptsLeft: parts.map((_, i) =>
        attemptsLeft(battle.attemptsPerVideo, me?.extraAttempts ?? 0, usedBySlot, slotKey(i, 1)),
      ),
    };
  });
}

/**
 * Checks that `userId` may add an attempt started at `startedAt` to this battle's slot: the
 * battle runs, the attempt was started before the deadline and attempts are left.
 */
export async function checkAttemptAllowed(
  db: Database,
  battle: BattleRow,
  participants: readonly { userId: string; extraAttempts: number }[],
  userId: string,
  slot: { partIndex: number; round: number; startedAt: number },
  now: number,
) {
  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  if (slot.startedAt > now + CLOCK_TOLERANCE_MS) apiError(400, 'start_in_the_future');
  if (battle.deadlineAt !== null && slot.startedAt > battle.deadlineAt)
    apiError(409, 'deadline_passed');
  const parts = (await requiredSubmissionsPerPerson(db, battle)) / battle.rounds;
  if (slot.partIndex >= parts || slot.round > battle.rounds) apiError(400, 'no_such_part');

  const mine = await db
    .select({ partIndex: attempts.partIndex, round: attempts.round })
    .from(attempts)
    .where(and(eq(attempts.battleId, battle.id), eq(attempts.userId, userId)));
  const used = new Map<string, number>();
  for (const a of mine) {
    const key = slotKey(a.partIndex, a.round);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  const me = participants.find((p) => p.userId === userId);
  const left = attemptsLeft(
    battle.attemptsPerVideo,
    me?.extraAttempts ?? 0,
    used,
    slotKey(slot.partIndex, slot.round),
  );
  if (left !== null && left <= 0) apiError(409, 'no_attempts_left');
}

/**
 * Assigns an inbox attempt (recorded offline by a friend) to a battle of its athlete that was
 * running at the recording time. The opponent must confirm it before it can count.
 */
export async function assignInboxAttempt(
  db: Database,
  attempt: AttemptRow,
  input: { battleId: string; partIndex: number },
  now: number,
) {
  if (attempt.battleId !== null) apiError(409, 'already_assigned');
  const battle = await db.select().from(battles).where(eq(battles.id, input.battleId)).get();
  if (!battle) apiError(404, 'not_found');
  const participants = await db
    .select({ userId: battleParticipants.userId, extraAttempts: battleParticipants.extraAttempts })
    .from(battleParticipants)
    .where(eq(battleParticipants.battleId, battle.id));
  if (!participants.some((p) => p.userId === attempt.userId)) apiError(404, 'not_found');
  if (battle.acceptedAt === null || attempt.startedAtClient < battle.acceptedAt)
    apiError(409, 'not_running_then');
  await checkAttemptAllowed(
    db,
    battle,
    participants,
    attempt.userId,
    { partIndex: input.partIndex, round: 1, startedAt: attempt.startedAtClient },
    now,
  );
  await db.batch([
    db
      .update(attempts)
      .set({
        battleId: battle.id,
        partIndex: input.partIndex,
        round: 1,
        assignment: 'pending',
        assignedAt: now,
        confirmedBy: null,
      })
      .where(and(eq(attempts.id, attempt.id), isNull(attempts.battleId))),
    db
      .update(videos)
      .set({ battleId: battle.id, partIndex: input.partIndex, round: 1 })
      .where(eq(videos.attemptId, attempt.id)),
  ]);
  return battle;
}

/** A later assignment was wrong: the attempt goes back to the athlete's inbox. */
export async function backToInbox(db: Database, attemptId: string) {
  await db.batch([
    db
      .update(attempts)
      .set({ battleId: null, partIndex: 0, assignment: null, assignedAt: null, confirmedBy: null })
      .where(eq(attempts.id, attemptId)),
    db.update(videos).set({ battleId: null, partIndex: 0 }).where(eq(videos.attemptId, attemptId)),
  ]);
}

/**
 * Announces the upload of an attempt's video and returns where to send the bytes. Repeating it
 * (e.g. after a failed upload) is fine. Used by the athlete and by friends with the code.
 */
export async function announceVideo(
  db: Database,
  env: Env,
  attempt: AttemptRow,
  input: CreateVideo,
  now: number,
) {
  if (attempt.battleId) {
    const battle = await db
      .select({ status: battles.status })
      .from(battles)
      .where(eq(battles.id, attempt.battleId))
      .get();
    if (battle?.status === 'cancelled') apiError(409, 'battle_cancelled');
  }
  const store = videoStore(env);
  const fields = {
    visibility: input.visibility,
    retention: input.retention,
    quality: input.quality,
    durationMs: input.durationMs,
    trimStartMs: input.trimStartMs,
    trimEndMs: input.trimEndMs,
    endReason: input.endReason,
  };
  const existing = await db.select().from(videos).where(eq(videos.attemptId, attempt.id)).get();
  let videoId: string;
  if (existing) {
    if (existing.status !== 'pending_upload') apiError(409, 'already_uploaded');
    videoId = existing.id;
    const key = originalKey(videoId, input.contentType);
    await db.batch([
      db.update(videos).set(fields).where(eq(videos.id, videoId)),
      db
        .update(videoFiles)
        .set({
          locator: key,
          sizeBytes: input.sizeBytes,
          contentType: input.contentType,
          createdAt: now,
          deletedAt: null,
        })
        .where(and(eq(videoFiles.videoId, videoId), eq(videoFiles.kind, 'original'))),
    ]);
  } else {
    videoId = newId(now);
    await db.batch([
      db.insert(videos).values({
        id: videoId,
        attemptId: attempt.id,
        ownerId: attempt.userId,
        battleId: attempt.battleId,
        partIndex: attempt.partIndex,
        round: attempt.round,
        recordedAt: attempt.startedAtClient,
        ...fields,
      }),
      db.insert(videoFiles).values({
        id: newId(now),
        videoId,
        kind: 'original',
        backend: store.backend,
        locator: originalKey(videoId, input.contentType),
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
        createdAt: now,
      }),
    ]);
  }
  const upload = await store.uploadTarget(
    originalKey(videoId, input.contentType),
    input.contentType,
    videoId,
  );
  return { videoId, upload, created: !existing };
}

/** Inbox attempts are deleted this long after the recording if nobody assigned them. */
export const INBOX_KEEP_DAYS = 30;

/**
 * Scheduled job: videos that stayed in an inbox for INBOX_KEEP_DAYS are marked deleted (their
 * files are removed by deleteFilesOfDeletedVideos), unless the athlete chose to keep them.
 */
export async function markOldInboxVideos(db: Database, now = Date.now()): Promise<number> {
  const rows = await db
    .select({ id: videos.id })
    .from(videos)
    .where(
      and(
        isNull(videos.battleId),
        lt(videos.recordedAt, now - INBOX_KEEP_DAYS * 86_400_000),
        ne(videos.status, 'deleted'),
        eq(videos.retention, 'delete_after_battle'),
      ),
    )
    .limit(90);
  if (rows.length === 0) return 0;
  await db
    .update(videos)
    .set({ status: 'deleted', deletedAt: now })
    .where(
      inArray(
        videos.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}
