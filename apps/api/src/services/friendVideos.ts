/**
 * Filming by friends (concept section 6, stage 2 plan §3.7). Whoever knows an athlete's code
 * can film attempts for them without an account, online only (owner, 2026-10-12): the friend
 * picks one of the athlete's running battles before recording and the attempt belongs to that
 * battle at once (`assignment = 'direct'`).
 *
 * The attempts belong to the athlete (`user_id`); `code_used` (the code's key) and
 * `recorder_name` say who filmed.
 */
import {
  ATHLETE_CODE_ALPHABET,
  ATHLETE_CODE_LENGTH,
  athleteCodeKey,
  attemptsLeft,
  type CreateVideo,
  slotKey,
} from '@hfb/shared';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
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

/** A random code like `K7M2-QX9P` (until the athlete chooses their own). */
function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ATHLETE_CODE_LENGTH));
  // 256 is not a multiple of 31: the first characters are very slightly more likely. Irrelevant
  // for a code that only needs to be hard to guess, not perfectly uniform.
  const code = [...bytes]
    .map((b) => ATHLETE_CODE_ALPHABET[b % ATHLETE_CODE_ALPHABET.length])
    .join('');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Stores `code` for the athlete; false if another athlete has the same code (key). */
async function storeCode(db: Database, userId: string, code: string): Promise<boolean> {
  try {
    await db
      .update(users)
      .set({ athleteCode: code, athleteCodeKey: athleteCodeKey(code) })
      .where(eq(users.id, userId));
    return true;
  } catch (err) {
    // Drizzle wraps the D1 error: the constraint is named in the cause.
    if (`${err} ${(err as { cause?: unknown })?.cause}`.includes('UNIQUE')) return false;
    throw err;
  }
}

/** The athlete's code; a random one is created on first use and with `renew`. */
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
    if (await storeCode(db, userId, code)) return code;
  }
  throw new Error('No free athlete code found');
}

/** The athlete chooses their own code (any text); 409 if someone else has it. */
export async function chooseAthleteCode(db: Database, userId: string, code: string) {
  if (!(await storeCode(db, userId, code))) apiError(409, 'code_taken');
  return code;
}

/** The active athlete with this code key (`athleteCodeKey`), or a 404. */
export async function athleteByCode(db: Database, code: string) {
  const athlete = await db
    .select({ id: users.id, displayName: users.displayName, status: users.status })
    .from(users)
    .where(and(eq(users.athleteCodeKey, code), isNull(users.deletedAt)))
    .get();
  if (athlete?.status !== 'active') apiError(404, 'unknown_code');
  return athlete;
}

/** The athlete's running battles whose deadline has not passed: a friend can film for these. */
export async function runningBattles(db: Database, athleteId: string, now: number) {
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
        or(isNull(battles.deadlineAt), gte(battles.deadlineAt, now)),
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
      .where(
        and(
          inArray(attempts.battleId, ids),
          eq(attempts.userId, athleteId),
          eq(attempts.provisional, false),
        ),
      ),
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
 * Checks that an attempt started at `startedAt` may be added to this battle's slot: the battle
 * runs and the attempt was started before the deadline. The attempt limit does not block it:
 * attempts beyond the allowance are provisional (`services/attempts.ts`).
 */
export async function checkAttemptAllowed(
  db: Database,
  battle: BattleRow,
  slot: { partIndex: number; round: number; startedAt: number },
  now: number,
) {
  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  if (slot.startedAt > now + CLOCK_TOLERANCE_MS) apiError(400, 'start_in_the_future');
  if (battle.deadlineAt !== null && slot.startedAt > battle.deadlineAt)
    apiError(409, 'deadline_passed');
  const parts = (await requiredSubmissionsPerPerson(db, battle)) / battle.rounds;
  if (slot.partIndex >= parts || slot.round > battle.rounds) apiError(400, 'no_such_part');
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
