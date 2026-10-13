/**
 * Recording and upload (concept section 6, architecture step 8):
 *
 * 1. Pressing Start creates an attempt on the phone (`POST /battles/:id/attempts`, sent as soon
 *    as there is a connection). Attempts beyond the limit are kept as provisional.
 * 2. The phone announces the video (`POST /videos`) and gets an upload target: a signed R2 URL,
 *    or `PUT /videos/:id/upload` through the Worker (see storage/videoStore.ts).
 * 3. After sending the bytes, `POST /videos/:id/complete` checks the stored file.
 *    Offline recording needs attempts reserved while online (`POST /battles/:id/reservations`);
 *    the device reports back (`.../reservations/:rid/report`) once online again.
 * 4. The athlete chooses the attempt that counts per part (`POST /battles/:id/submissions`).
 *    Once everyone has chosen, the videos unlock and the battle moves on to the review.
 */
import {
  createVideoSchema,
  MAX_VIDEO_BYTES,
  registerAttemptSchema,
  reportReservationSchema,
  reserveAttemptsSchema,
  submitVideoSchema,
  videoSettingsSchema,
} from '@hfb/shared';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { type Database, getDb } from '../db/client';
import {
  attempts,
  battleParticipants,
  battles,
  submissions,
  videoFiles,
  videos,
} from '../db/schema';
import type { AppEnv, Env } from '../env';
import { apiError } from '../lib/errors';
import { parseJson } from '../lib/validate';
import {
  discardAttempt,
  insertAttempt,
  ownReservation,
  reportReservation,
  reserveAttempts,
} from '../services/attempts';
import { eventStatement } from '../services/battleEvents';
import { announceVideo, checkAttemptAllowed } from '../services/friendVideos';
import { notify, requestNotifyContext } from '../services/notify';
import { mayViewVideo, unlockIfComplete } from '../services/videos';
import { uploadsThroughWorker, videoStore } from '../storage/videoStore';
import { battleResponse, loadBattle, requireParticipant } from './battles';

// ---------------------------------------------------------------------------------------------
// Under /battles/:id
// ---------------------------------------------------------------------------------------------

export const battleVideoRoutes = new Hono<AppEnv>();
battleVideoRoutes.use(requireUser({ active: true }));

/**
 * Register an attempt (pressing Start). Sending the same attempt again changes nothing.
 * Attempts started before the deadline count even if they arrive later (no connection at the
 * line), as long as the battle is still running.
 */
battleVideoRoutes.post('/:id/attempts', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, registerAttemptSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);

  const existing = await db.select().from(attempts).where(eq(attempts.id, input.id)).get();
  if (existing) {
    if (existing.userId !== user.id || existing.battleId !== battle.id)
      apiError(409, 'attempt_id_taken');
    return c.json(await battleResponse(db, battle.id, user.id, now));
  }

  await checkAttemptAllowed(db, battle, input, now);
  await insertAttempt(
    db,
    battle,
    user.id,
    input,
    { deviceCode: input.deviceCode ?? null, codeUsed: null, recorderName: null, recordedBy: null },
    now,
  );
  return c.json(await battleResponse(db, battle.id, user.id, now), 201);
});

/** A recording shorter than 3 seconds does not count: the phone removes the attempt again. */
battleVideoRoutes.post('/:id/attempts/:attemptId/discard', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const attempt = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, c.req.param('attemptId')))
    .get();
  if (!attempt || attempt.userId !== user.id || attempt.battleId !== c.req.param('id'))
    apiError(404, 'not_found');
  await discardAttempt(db, attempt, Date.now());
  return c.json(await battleResponse(db, c.req.param('id'), user.id));
});

/**
 * "Prepare for offline recording" (concept section 6): reserve attempts per part on this device.
 * Reserved attempts count as used at once; the device must report back once online.
 */
battleVideoRoutes.post('/:id/reservations', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, reserveAttemptsSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  for (const part of input.parts)
    await checkAttemptAllowed(db, battle, { ...part, startedAt: now }, now);
  await reserveAttempts(
    db,
    battle,
    user.id,
    input,
    { deviceCode: input.deviceCode, codeUsed: null, recorderName: null, recordedBy: null },
    now,
  );
  return c.json(await battleResponse(db, battle.id, user.id, now), 201);
});

/** Back online: the device's attempts are registered; optionally hand back the unused ones. */
battleVideoRoutes.post('/:id/reservations/:reservationId/report', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, reportReservationSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle } = await loadBattle(db, c.req.param('id'));
  const reservation = await ownReservation(
    db,
    battle.id,
    c.req.param('reservationId'),
    user.id,
    input.deviceCode,
  );
  await reportReservation(db, battle, reservation, input.handBack, now);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/**
 * Choose the attempt that counts for its part (best of N). It can be changed until the videos
 * unlock, i.e. until everyone has chosen.
 */
battleVideoRoutes.post('/:id/submissions', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { videoId } = await parseJson(c, submitVideoSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.status !== 'active') apiError(409, 'battle_not_running');

  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video || video.ownerId !== user.id || video.battleId !== battle.id)
    apiError(404, 'not_found');
  if (video.status !== 'uploaded' && video.status !== 'ready') apiError(409, 'not_uploaded_yet');
  const attempt = await db.select().from(attempts).where(eq(attempts.id, video.attemptId)).get();
  if (attempt?.provisional) apiError(409, 'attempt_provisional');
  if (battle.deadlineAt !== null && (attempt?.startedAtClient ?? now) > battle.deadlineAt)
    apiError(409, 'deadline_passed');

  await db
    .insert(submissions)
    .values({
      battleId: battle.id,
      userId: user.id,
      partIndex: video.partIndex,
      round: video.round,
      videoId: video.id,
      submittedAt: now,
    })
    .onConflictDoUpdate({
      target: [submissions.battleId, submissions.userId, submissions.partIndex, submissions.round],
      set: { videoId: video.id, submittedAt: now },
    });
  await eventStatement(db, battle.id, user.id, { type: 'submitted' }, now);
  if (
    await unlockIfComplete(
      db,
      battle,
      participants.map((p) => p.userId),
      now,
    )
  ) {
    await eventStatement(db, battle.id, user.id, { type: 'unlocked' }, now + 1);
    await notify(requestNotifyContext(c), {
      userIds: participants.map((p) => p.userId),
      kind: 'unlocked',
      battleId: battle.id,
      actorId: user.id,
    });
  }
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

// ---------------------------------------------------------------------------------------------
// Under /videos
// ---------------------------------------------------------------------------------------------

export const videoRoutes = new Hono<AppEnv>();
videoRoutes.use(requireUser({ active: true }));

/** Announce the upload of an attempt's video. Repeating it (e.g. after a failed upload) is fine. */
videoRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, createVideoSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const attempt = await db.select().from(attempts).where(eq(attempts.id, input.attemptId)).get();
  if (!attempt || attempt.userId !== user.id) apiError(404, 'attempt_not_found');
  const { videoId, upload, created } = await announceVideo(db, c.env, attempt, input, now);
  return c.json({ video: { id: videoId, status: 'pending_upload' }, upload }, created ? 201 : 200);
});

async function ownOriginal(c: Context<AppEnv>, videoId: string) {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video || video.ownerId !== user.id) apiError(404, 'not_found');
  return { db, video, file: await originalOf(db, video) };
}

/** The stored original of a video, for its upload. */
export async function originalOf(db: Database, video: typeof videos.$inferSelect) {
  const file = await db
    .select()
    .from(videoFiles)
    .where(and(eq(videoFiles.videoId, video.id), eq(videoFiles.kind, 'original')))
    .get();
  if (!file) apiError(404, 'not_found');
  return file;
}

/** Stores the request body as the video's original (uploads through the Worker). */
export async function storeUploadBody(
  c: Context<AppEnv>,
  video: typeof videos.$inferSelect,
  file: typeof videoFiles.$inferSelect,
) {
  if (video.status !== 'pending_upload') apiError(409, 'already_uploaded');
  const length = Number(c.req.header('Content-Length'));
  if (!Number.isFinite(length) || length <= 0) apiError(411, 'length_required');
  if (length > MAX_VIDEO_BYTES) apiError(413, 'video_too_large');
  const body = c.req.raw.body;
  if (!body) apiError(400, 'empty_body');
  await c.env.VIDEOS.put(file.locator, body, {
    httpMetadata: { contentType: file.contentType ?? 'video/mp4' },
  });
}

/** The bytes have been sent: check the stored file and mark the video as uploaded. */
export async function completeUpload(
  db: Database,
  env: Env,
  video: typeof videos.$inferSelect,
  file: typeof videoFiles.$inferSelect,
) {
  if (video.status !== 'pending_upload') return { id: video.id, status: video.status };
  const store = videoStore(env);
  const size = await store.size(file.locator);
  if (size === null) apiError(409, 'upload_missing');
  if (size > MAX_VIDEO_BYTES) {
    await store.delete(file.locator);
    apiError(413, 'video_too_large');
  }
  if (file.sizeBytes !== null && size !== file.sizeBytes) apiError(409, 'upload_incomplete');
  const now = Date.now();
  await db.batch([
    db.update(videos).set({ status: 'uploaded', uploadedAt: now }).where(eq(videos.id, video.id)),
    db.update(videoFiles).set({ sizeBytes: size }).where(eq(videoFiles.id, file.id)),
  ]);
  return { id: video.id, status: 'uploaded' as const };
}

/** Upload through the Worker; only used while there is no R2 access key (see videoStore.ts). */
videoRoutes.put('/:id/upload', async (c) => {
  if (!uploadsThroughWorker(c.env)) apiError(404, 'not_found');
  const { video, file } = await ownOriginal(c, c.req.param('id'));
  await storeUploadBody(c, video, file);
  return c.json({ ok: true });
});

videoRoutes.post('/:id/complete', async (c) => {
  const { db, video, file } = await ownOriginal(c, c.req.param('id'));
  return c.json({ video: await completeUpload(db, c.env, video, file) });
});

/** The owner changes who may watch the video and whether it is kept after the battle. */
videoRoutes.post('/:id/settings', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, videoSettingsSchema);
  const db = getDb(c.env.DB);
  const video = await db
    .select()
    .from(videos)
    .where(eq(videos.id, c.req.param('id')))
    .get();
  if (!video || video.ownerId !== user.id || video.status === 'deleted') apiError(404, 'not_found');
  await db.update(videos).set(input).where(eq(videos.id, video.id));
  return c.json({ video: { id: video.id, ...input } });
});

/** Watch a video (owner; participants and others once unlocked, see canViewVideo). */
videoRoutes.get('/:id/file', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const video = await db
    .select()
    .from(videos)
    .where(eq(videos.id, c.req.param('id')))
    .get();
  if (!video || (video.status !== 'uploaded' && video.status !== 'ready'))
    apiError(404, 'not_found');
  let battle: typeof battles.$inferSelect | null = null;
  let participantIds: string[] = [];
  if (video.battleId) {
    battle = (await db.select().from(battles).where(eq(battles.id, video.battleId)).get()) ?? null;
    participantIds = (
      await db
        .select({ userId: battleParticipants.userId })
        .from(battleParticipants)
        .where(eq(battleParticipants.battleId, video.battleId))
    ).map((p) => p.userId);
  }
  if (!(await mayViewVideo(db, video, user.id, participantIds, battle))) apiError(404, 'not_found');
  const file = await db
    .select()
    .from(videoFiles)
    .where(and(eq(videoFiles.videoId, video.id), eq(videoFiles.kind, 'original')))
    .get();
  if (!file || file.deletedAt !== null) apiError(404, 'not_found');
  return videoStore(c.env).serve(file.locator, c.req.raw);
});
