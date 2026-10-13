/**
 * Filming by friends without an account, online only (concept section 6): every call carries
 * the athlete's code instead of a login. See services/friendVideos.ts.
 *
 * Whoever knows the code can see the athlete's running battles and use up their attempts, so the
 * athlete can change the code at any time (`PUT /api/athlete-code`, or a random one with
 * `POST /api/athlete-code/renew`). Uploads already started keep working with the code they
 * were started with.
 */
import {
  athleteCodeKey,
  chooseAthleteCodeSchema,
  createVideoSchema,
  guestAttemptSchema,
  guestCodeSchema,
  guestLookupSchema,
  guestReportSchema,
  guestReserveSchema,
  guestVideoSchema,
} from '@hfb/shared';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { type Database, getDb } from '../db/client';
import { attemptReservations, attempts, battleParticipants, battles, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { parseJson } from '../lib/validate';
import {
  discardAttempt,
  insertAttempt,
  reportReservation,
  reserveAttempts,
} from '../services/attempts';
import {
  announceVideo,
  athleteByCode,
  athleteCode,
  checkAttemptAllowed,
  chooseAthleteCode,
  runningBattles,
} from '../services/friendVideos';
import { uploadsThroughWorker } from '../storage/videoStore';
import { completeUpload, originalOf, storeUploadBody } from './videos';

/** Header that carries the code on uploads through the Worker (PUT has a video as body). */
const CODE_HEADER = 'X-Athlete-Code';

/** Mounted at /api/guest. No login needed. */
export const guestRoutes = new Hono<AppEnv>();

/** Whose code is it, and which of their battles can be filmed now? */
guestRoutes.post('/lookup', async (c) => {
  const { code } = await parseJson(c, guestLookupSchema);
  const db = getDb(c.env.DB);
  const athlete = await athleteByCode(db, code);
  return c.json({
    athlete: { displayName: athlete.displayName },
    battles: await runningBattles(db, athlete.id, Date.now()),
  });
});

/**
 * Start pressed on the friend's phone: the attempt counts in the chosen battle at once (same
 * checks as the athlete's own attempts).
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
  const { battle } = await athleteBattle(db, input.battleId, athlete.id);
  await checkAttemptAllowed(db, battle, input, now);
  await insertAttempt(
    db,
    battle,
    athlete.id,
    input,
    {
      deviceCode: input.deviceCode ?? null,
      codeUsed: input.code,
      recorderName: input.recorderName || null,
      recordedBy: c.get('user')?.id ?? null,
    },
    now,
  );
  return c.json({ ok: true, battleId: input.battleId }, 201);
});

/** One of the athlete's battles, or a 404. */
async function athleteBattle(db: Database, battleId: string, athleteId: string) {
  const battle = await db.select().from(battles).where(eq(battles.id, battleId)).get();
  if (!battle) apiError(404, 'not_found');
  const participants = await db
    .select({ userId: battleParticipants.userId })
    .from(battleParticipants)
    .where(eq(battleParticipants.battleId, battle.id));
  if (!participants.some((p) => p.userId === athleteId)) apiError(404, 'not_found');
  return { battle };
}

/**
 * The friend prepares for filming offline (concept section 6): reserves attempts on their
 * device, like the athlete can. Returns the reservations (count 0 = nothing was free).
 */
guestRoutes.post('/reservations', async (c) => {
  const input = await parseJson(c, guestReserveSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const athlete = await athleteByCode(db, input.code);
  const { battle } = await athleteBattle(db, input.battleId, athlete.id);
  for (const part of input.parts)
    await checkAttemptAllowed(db, battle, { ...part, startedAt: now }, now);
  const rows = await reserveAttempts(
    db,
    battle,
    athlete.id,
    input,
    {
      deviceCode: input.deviceCode,
      codeUsed: input.code,
      recorderName: input.recorderName || null,
      recordedBy: c.get('user')?.id ?? null,
    },
    now,
  );
  return c.json({ reservations: rows.map(reservationView) }, 201);
});

/** Back online: report the friend's attempts and optionally hand back the unused ones. */
guestRoutes.post('/reservations/:id/report', async (c) => {
  const input = await parseJson(c, guestReportSchema);
  const db = getDb(c.env.DB);
  const reservation = await db
    .select()
    .from(attemptReservations)
    .where(eq(attemptReservations.id, c.req.param('id')))
    .get();
  if (
    !reservation ||
    reservation.codeUsed !== input.code ||
    reservation.deviceCode !== input.deviceCode
  )
    apiError(404, 'not_found');
  const battle = await db.select().from(battles).where(eq(battles.id, reservation.battleId)).get();
  if (!battle) apiError(404, 'not_found');
  const updated = await reportReservation(db, battle, reservation, input.handBack, Date.now());
  return c.json({ reservation: reservationView(updated) });
});

function reservationView(r: typeof attemptReservations.$inferSelect) {
  return {
    id: r.id,
    battleId: r.battleId,
    partIndex: r.partIndex,
    round: r.round,
    count: r.count,
    requested: r.requested,
    takeover: r.takeover,
    createdAt: r.createdAt,
    closedAt: r.closedAt,
  };
}

/** A recording shorter than 3 seconds does not count: the friend's phone removes it again. */
guestRoutes.post('/attempts/:id/discard', async (c) => {
  const { code } = await parseJson(c, guestCodeSchema);
  const db = getDb(c.env.DB);
  const attempt = await codeAttempt(db, c.req.param('id'), code);
  await discardAttempt(db, attempt, Date.now());
  return c.json({ ok: true });
});

/** An attempt this code started (the code it was started with, even if renewed since). */
async function codeAttempt(db: Database, attemptId: string, code: string) {
  const attempt = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt || attempt.codeUsed !== code) apiError(404, 'not_found');
  return attempt;
}

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
  const { video, file } = await codeVideo(c, athleteCodeKey(c.req.header(CODE_HEADER) ?? ''));
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
  return c.json({ code: await athleteCode(getDb(c.env.DB), user.id) });
});

/** Choose my own code (any text, unique); the old one stops working for new recordings. */
athleteCodeRoutes.put('/', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { code } = await parseJson(c, chooseAthleteCodeSchema);
  return c.json({ code: await chooseAthleteCode(getDb(c.env.DB), user.id, code) });
});

/** A new random code; the old one stops working for new recordings. */
athleteCodeRoutes.post('/renew', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  return c.json({ code: await athleteCode(getDb(c.env.DB), user.id, true) });
});
