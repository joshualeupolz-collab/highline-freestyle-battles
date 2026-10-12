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
  assignAttemptSchema,
  assignmentDecisionSchema,
  createVideoSchema,
  MAX_VIDEO_BYTES,
  registerAttemptSchema,
  submitVideoSchema,
  videoSettingsSchema,
} from '@hfb/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
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
import { eventStatement } from '../services/battleEvents';
import {
  announceVideo,
  assignInboxAttempt,
  backToInbox,
  battlesRunningAt,
  checkAttemptAllowed,
} from '../services/friendVideos';
import { notify, requestNotifyContext } from '../services/notify';
import { markVideosDeleted, mayViewVideo, unlockIfComplete } from '../services/videos';
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

  await checkAttemptAllowed(db, battle, participants, user.id, input, now);

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
  // Filmed by a friend and assigned later: counts once the opponent confirmed it.
  if (attempt?.assignment === 'pending') apiError(409, 'assignment_unconfirmed');
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

/**
 * A video a friend filmed offline and that was assigned to this battle later: the opponent
 * confirms that it belongs here or rejects it; the athlete can take it back (wrong battle).
 * Rejected or taken back, it returns to the athlete's inbox.
 */
battleVideoRoutes.post('/:id/assignments/:attemptId', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { action } = await parseJson(c, assignmentDecisionSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  const attempt = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, c.req.param('attemptId')))
    .get();
  if (!attempt || attempt.battleId !== battle.id || attempt.assignment !== 'pending')
    apiError(404, 'not_found');
  const isAthlete = attempt.userId === user.id;
  if (action === 'confirm') {
    if (isAthlete) apiError(403, 'opponent_confirms');
    await db
      .update(attempts)
      .set({ assignment: 'confirmed', confirmedBy: user.id })
      .where(eq(attempts.id, attempt.id));
  } else {
    await backToInbox(db, attempt.id);
  }
  await eventStatement(
    db,
    battle.id,
    user.id,
    { type: action === 'confirm' ? 'video_confirmed' : 'video_rejected' },
    now,
  );
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

// ---------------------------------------------------------------------------------------------
// Inbox: attempts friends recorded offline with my code (filming by friends)
// ---------------------------------------------------------------------------------------------

/** My inbox, each with the battles that were running at its recording time. */
videoRoutes.get('/inbox', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ attempt: attempts, video: videos })
    .from(attempts)
    .leftJoin(videos, eq(videos.attemptId, attempts.id))
    .where(and(eq(attempts.userId, user.id), isNull(attempts.battleId)))
    .orderBy(desc(attempts.startedAtClient))
    .limit(30);
  const items = [];
  for (const { attempt, video } of rows) {
    if (video?.status === 'deleted') continue;
    items.push({
      id: attempt.id,
      recordedAt: attempt.startedAtClient,
      recorderName: attempt.recorderName,
      description: attempt.description,
      video: video
        ? {
            id: video.id,
            status: video.status,
            durationMs: video.durationMs,
            visibility: video.visibility,
            retention: video.retention,
          }
        : null,
      battles: await battlesRunningAt(db, user.id, attempt.startedAtClient),
    });
  }
  return c.json({ inbox: items });
});

async function myInboxAttempt(c: Context<AppEnv>) {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const attempt = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, c.req.param('attemptId') ?? ''))
    .get();
  if (!attempt || attempt.userId !== user.id) apiError(404, 'not_found');
  return { db, user, attempt };
}

/** Assign an inbox video to a battle that was running then; the opponent confirms it. */
videoRoutes.post('/inbox/:attemptId/assign', async (c) => {
  const input = await parseJson(c, assignAttemptSchema);
  const { db, user, attempt } = await myInboxAttempt(c);
  const now = Date.now();
  const battle = await assignInboxAttempt(db, attempt, input, now);
  await eventStatement(db, battle.id, user.id, { type: 'video_assigned' }, now);
  return c.json({ ok: true, battleId: battle.id });
});

/** Delete an inbox video (e.g. filmed for nothing). */
videoRoutes.post('/inbox/:attemptId/delete', async (c) => {
  const { db, attempt } = await myInboxAttempt(c);
  if (attempt.battleId !== null) apiError(409, 'already_assigned');
  const now = Date.now();
  const video = await db.select().from(videos).where(eq(videos.attemptId, attempt.id)).get();
  if (video) await markVideosDeleted(db, [video.id], now);
  else await db.delete(attempts).where(eq(attempts.id, attempt.id));
  return c.json({ ok: true });
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
