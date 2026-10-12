/**
 * Filming by friends without an account (concept section 6): every call carries the athlete's
 * code instead of a login. See services/friendVideos.ts for the flow.
 *
 * Whoever knows the code can see the athlete's running battles and use up their attempts, so the
 * athlete can renew the code at any time (`POST /api/athlete-code/renew`). Uploads already
 * started keep working with the code they were started with.
 */
import {
  createVideoSchema,
  formatAthleteCode,
  guestAssignSchema,
  guestAttemptSchema,
  guestCodeSchema,
  guestLookupSchema,
  guestVideoSchema,
  normalizeAthleteCode,
} from '@hfb/shared';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { type Database, getDb } from '../db/client';
import { attempts, battleParticipants, battles, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { parseJson } from '../lib/validate';
import { eventStatement } from '../services/battleEvents';
import {
  announceVideo,
  assignInboxAttempt,
  athleteByCode,
  athleteCode,
  battlesRunningAt,
  CLOCK_TOLERANCE_MS,
  checkAttemptAllowed,
} from '../services/friendVideos';
import { uploadsThroughWorker } from '../storage/videoStore';
import { completeUpload, originalOf, storeUploadBody } from './videos';

/** Header that carries the code on uploads through the Worker (PUT has a video as body). */
const CODE_HEADER = 'X-Athlete-Code';

/** Mounted at /api/guest. No login needed. */
export const guestRoutes = new Hono<AppEnv>();

/** Whose code is it, and which of their battles can be filmed (now, or at `at`)? */
guestRoutes.post('/lookup', async (c) => {
  const { code, at } = await parseJson(c, guestLookupSchema);
  const db = getDb(c.env.DB);
  const athlete = await athleteByCode(db, code);
  return c.json({
    athlete: { displayName: athlete.displayName },
    battles: await battlesRunningAt(db, athlete.id, at ?? Date.now()),
  });
});

/**
 * Start pressed on the friend's phone. With a battle, the attempt counts there at once (same
 * checks as the athlete's own attempts); without, it goes to the athlete's inbox.
 */
guestRoutes.post('/attempts', async (c) => {
  const input = await parseJson(c, guestAttemptSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const athlete = await athleteByCode(db, input.code);

  const existing = await db.select().from(attempts).where(eq(attempts.id, input.id)).get();
  if (existing) {
    if (existing.userId !== athlete.id || existing.codeUsed !== input.code)
      apiError(409, 'attempt_id_taken');
    return c.json({ ok: true, battleId: existing.battleId });
  }
  if (input.startedAt > now + CLOCK_TOLERANCE_MS) apiError(400, 'start_in_the_future');

  if (input.battleId) {
    const battle = await db.select().from(battles).where(eq(battles.id, input.battleId)).get();
    if (!battle) apiError(404, 'not_found');
    const participants = await db
      .select({
        userId: battleParticipants.userId,
        extraAttempts: battleParticipants.extraAttempts,
      })
      .from(battleParticipants)
      .where(eq(battleParticipants.battleId, battle.id));
    if (!participants.some((p) => p.userId === athlete.id)) apiError(404, 'not_found');
    await checkAttemptAllowed(db, battle, participants, athlete.id, input, now);
  } else if (!input.description) apiError(400, 'description_required');

  await db.insert(attempts).values({
    id: input.id,
    battleId: input.battleId,
    userId: athlete.id,
    partIndex: input.battleId ? input.partIndex : 0,
    round: input.battleId ? input.round : 1,
    startedAtClient: input.startedAt,
    syncedAt: now,
    recordedBy: c.get('user')?.id ?? null,
    codeUsed: input.code,
    recorderName: input.recorderName || null,
    description: input.description || null,
    assignment: input.battleId ? 'direct' : null,
  });
  return c.json({ ok: true, battleId: input.battleId }, 201);
});

/** An attempt this code started (the code it was started with, even if renewed since). */
async function codeAttempt(db: Database, attemptId: string, code: string) {
  const attempt = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt || attempt.codeUsed !== code) apiError(404, 'not_found');
  return attempt;
}

/** Back online: the friend assigns an attempt recorded offline to one of the battles then. */
guestRoutes.post('/attempts/:id/assign', async (c) => {
  const input = await parseJson(c, guestAssignSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const attempt = await codeAttempt(db, c.req.param('id'), input.code);
  const battle = await assignInboxAttempt(db, attempt, input, now);
  await eventStatement(db, battle.id, attempt.userId, { type: 'video_assigned' }, now);
  return c.json({ ok: true, battleId: battle.id });
});

/** Announce the upload of an attempt's video (like POST /api/videos). */
guestRoutes.post('/videos', async (c) => {
  const input = await parseJson(c, guestVideoSchema);
  const db = getDb(c.env.DB);
  const attempt = await codeAttempt(db, input.attemptId, input.code);
  const { videoId, upload, created } = await announceVideo(
    db,
    c.env,
    attempt,
    createVideoSchema.parse(input),
    Date.now(),
  );
  // Uploads through the Worker go to the guest route, with the code in a header.
  if (upload.url.startsWith('/api/videos/')) {
    upload.url = upload.url.replace('/api/videos/', '/api/guest/videos/');
    upload.headers[CODE_HEADER] = input.code;
  }
  return c.json({ video: { id: videoId, status: 'pending_upload' }, upload }, created ? 201 : 200);
});

async function codeVideo(c: Context<AppEnv>, code: string) {
  const db = getDb(c.env.DB);
  const video = await db
    .select()
    .from(videos)
    .where(eq(videos.id, c.req.param('id') ?? ''))
    .get();
  if (!video) apiError(404, 'not_found');
  await codeAttempt(db, video.attemptId, code);
  return { db, video, file: await originalOf(db, video) };
}

guestRoutes.put('/videos/:id/upload', async (c) => {
  if (!uploadsThroughWorker(c.env)) apiError(404, 'not_found');
  const { video, file } = await codeVideo(c, normalizeAthleteCode(c.req.header(CODE_HEADER) ?? ''));
  await storeUploadBody(c, video, file);
  return c.json({ ok: true });
});

guestRoutes.post('/videos/:id/complete', async (c) => {
  const { code } = await parseJson(c, guestCodeSchema);
  const { db, video, file } = await codeVideo(c, code);
  return c.json({ video: await completeUpload(db, c.env, video, file) });
});

/** Mounted at /api/athlete-code: my own code, to give to friends who film me. */
export const athleteCodeRoutes = new Hono<AppEnv>();
athleteCodeRoutes.use(requireUser({ active: true }));

athleteCodeRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const code = await athleteCode(getDb(c.env.DB), user.id);
  return c.json({ code: formatAthleteCode(code) });
});

/** A new code; the old one stops working for new recordings. */
athleteCodeRoutes.post('/renew', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const code = await athleteCode(getDb(c.env.DB), user.id, true);
  return c.json({ code: formatAthleteCode(code) });
});
