/**
 * Recording and upload (concept section 6, architecture step 8):
 *
 * 1. Pressing Start creates an attempt on the phone (`POST /battles/:id/attempts`, sent as soon
 *    as there is a connection). The attempt limit is checked here.
 * 2. The phone announces the video (`POST /videos`) and gets an upload target: a signed R2 URL,
 *    or `PUT /videos/:id/upload` through the Worker (see storage/videoStore.ts).
 * 3. After sending the bytes, `POST /videos/:id/complete` checks the stored file.
 * 4. The athlete chooses the attempt that counts per part (`POST /battles/:id/submissions`).
 *    Once everyone has chosen, the videos unlock and the battle moves on to the review.
 */
import {
  attemptsLeft,
  createVideoSchema,
  MAX_VIDEO_BYTES,
  registerAttemptSchema,
  slotKey,
  submitVideoSchema,
} from '@hfb/shared';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { getDb } from '../db/client';
import {
  attempts,
  battleParticipants,
  battles,
  submissions,
  videoFiles,
  videos,
} from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { eventStatement } from '../services/battleEvents';
import { requiredSubmissionsPerPerson } from '../services/battles';
import { notify, requestNotifyContext } from '../services/notify';
import { mayViewVideo, unlockIfComplete } from '../services/videos';
import { originalKey, uploadsThroughWorker, videoStore } from '../storage/videoStore';
import { battleResponse, loadBattle, requireParticipant } from './battles';

/** The phone's clock may be a little ahead of ours. */
const CLOCK_TOLERANCE_MS = 5 * 60_000;

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

  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  if (input.startedAt > now + CLOCK_TOLERANCE_MS) apiError(400, 'start_in_the_future');
  if (battle.deadlineAt !== null && input.startedAt > battle.deadlineAt)
    apiError(409, 'deadline_passed');
  const parts = (await requiredSubmissionsPerPerson(db, battle)) / battle.rounds;
  if (input.partIndex >= parts || input.round > battle.rounds) apiError(400, 'no_such_part');

  const mine = await db
    .select({ partIndex: attempts.partIndex, round: attempts.round })
    .from(attempts)
    .where(and(eq(attempts.battleId, battle.id), eq(attempts.userId, user.id)));
  const used = new Map<string, number>();
  for (const a of mine) {
    const key = slotKey(a.partIndex, a.round);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  const me = participants.find((p) => p.userId === user.id);
  const left = attemptsLeft(
    battle.attemptsPerVideo,
    me?.extraAttempts ?? 0,
    used,
    slotKey(input.partIndex, input.round),
  );
  if (left !== null && left <= 0) apiError(409, 'no_attempts_left');

  await db.insert(attempts).values({
    id: input.id,
    battleId: battle.id,
    userId: user.id,
    partIndex: input.partIndex,
    round: input.round,
    startedAtClient: input.startedAt,
    syncedAt: now,
  });
  return c.json(await battleResponse(db, battle.id, user.id, now), 201);
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
  if (attempt.battleId) {
    const battle = await db
      .select({ status: battles.status })
      .from(battles)
      .where(eq(battles.id, attempt.battleId))
      .get();
    if (battle?.status === 'cancelled') apiError(409, 'battle_cancelled');
  }

  const store = videoStore(c.env);
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
        ownerId: user.id,
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
  return c.json({ video: { id: videoId, status: 'pending_upload' }, upload }, existing ? 200 : 201);
});

async function ownOriginal(c: Context<AppEnv>, videoId: string) {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video || video.ownerId !== user.id) apiError(404, 'not_found');
  const file = await db
    .select()
    .from(videoFiles)
    .where(and(eq(videoFiles.videoId, video.id), eq(videoFiles.kind, 'original')))
    .get();
  if (!file) apiError(404, 'not_found');
  return { db, video, file };
}

/** Upload through the Worker; only used while there is no R2 access key (see videoStore.ts). */
videoRoutes.put('/:id/upload', async (c) => {
  if (!uploadsThroughWorker(c.env)) apiError(404, 'not_found');
  const { video, file } = await ownOriginal(c, c.req.param('id'));
  if (video.status !== 'pending_upload') apiError(409, 'already_uploaded');
  const length = Number(c.req.header('Content-Length'));
  if (!Number.isFinite(length) || length <= 0) apiError(411, 'length_required');
  if (length > MAX_VIDEO_BYTES) apiError(413, 'video_too_large');
  const body = c.req.raw.body;
  if (!body) apiError(400, 'empty_body');
  await c.env.VIDEOS.put(file.locator, body, {
    httpMetadata: { contentType: file.contentType ?? 'video/mp4' },
  });
  return c.json({ ok: true });
});

/** The bytes have been sent: check the stored file and mark the video as uploaded. */
videoRoutes.post('/:id/complete', async (c) => {
  const { db, video, file } = await ownOriginal(c, c.req.param('id'));
  if (video.status !== 'pending_upload')
    return c.json({ video: { id: video.id, status: video.status } });
  const store = videoStore(c.env);
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
  return c.json({ video: { id: video.id, status: 'uploaded' } });
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
