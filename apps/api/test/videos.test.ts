import { env } from 'cloudflare:workers';
import { attemptsLeft, newId } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { canViewVideo } from '../src/auth/permissions';
import { getDb } from '../src/db/client';
import { removeStaleUploads, STALE_UPLOAD_MS } from '../src/services/videos';
import { videoStore } from '../src/storage/videoStore';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

interface Slot {
  userId: string;
  partIndex: number;
  attempts: number;
  uploaded: number;
  submittedAt: number | null;
  videoId: string | null;
}
interface Battle {
  id: string;
  status: string;
  participants: { userId: string; extraAttempts: number }[];
  proposals: { id: string; kind: string }[];
  videos: {
    unlocked: boolean;
    slots: Slot[];
    mine: { id: string; video: { id: string; status: string; counts: boolean } | null }[];
    sharedWithMe: { id: string; ownerId: string }[];
  };
}

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let admin: Person;
let anna: Person;
let ben: Person;
let carla: Person;

beforeEach(async () => {
  admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
  carla = await registerAthlete('carla', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

const post = <T = { battle: Battle; error?: string }>(who: Person, path: string, body?: unknown) =>
  json<T>(call(path, { method: 'POST', session: who.session, body }));

async function activeBattle(settings: Record<string, unknown> = {}) {
  const res = await post(anna, '/api/battles', { formatId: BEST_TRICK, settings });
  expect(res.status).toBe(201);
  const id = res.body.battle.id;
  await post(ben, `/api/battles/${id}/accept`);
  return id;
}

function attempt(who: Person, battleId: string, partIndex = 0) {
  return post(who, `/api/battles/${battleId}/attempts`, {
    id: newId(),
    partIndex,
    startedAt: Date.now(),
  });
}

const app = createApp();

/** Uploads like the phone does without R2 access keys: through the Worker. */
async function upload(who: Person, attemptId: string, bytes = new Uint8Array([1, 2, 3, 4, 5])) {
  const created = await post<{
    video: { id: string };
    upload: { url: string; method: string; headers: Record<string, string> };
    error?: string;
  }>(who, '/api/videos', {
    attemptId,
    contentType: 'video/mp4',
    sizeBytes: bytes.length,
    durationMs: 1000,
  });
  expect(created.status, created.body.error).toBeLessThan(300);
  const { url, headers } = created.body.upload;
  expect(url).toBe(`/api/videos/${created.body.video.id}/upload`);
  const put = await app.request(
    url,
    {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Length': String(bytes.length),
        Cookie: `hfb_session=${who.session}`,
        Origin: 'http://localhost',
      },
      body: bytes,
    },
    env,
  );
  expect(put.status).toBe(200);
  const done = await post<{ video: { status: string } }>(
    who,
    `/api/videos/${created.body.video.id}/complete`,
  );
  expect(done.body.video.status).toBe('uploaded');
  return created.body.video.id;
}

/** Records, uploads and submits one video; returns its id. */
async function deliver(who: Person, battleId: string) {
  const res = await attempt(who, battleId);
  const attemptId = res.body.battle.videos.mine.at(-1)?.id as string;
  const videoId = await upload(who, attemptId);
  const submitted = await post(who, `/api/battles/${battleId}/submissions`, { videoId });
  expect(submitted.status, submitted.body.error).toBe(200);
  return { videoId, battle: submitted.body.battle };
}

const file = (who: Person, videoId: string, headers: Record<string, string> = {}) =>
  call(`/api/videos/${videoId}/file`, { session: who.session, headers });

describe('attempts', () => {
  it('counts attempts per part and stops at the limit', async () => {
    const id = await activeBattle({ attemptsPerVideo: 2 });
    expect((await attempt(anna, id)).status).toBe(201);
    expect((await attempt(anna, id)).status).toBe(201);
    const third = await attempt(anna, id);
    expect(third.status).toBe(409);
    expect(third.body.error).toBe('no_attempts_left');

    // Goodwill: one extra attempt.
    await post(ben, `/api/battles/${id}/grant-attempt`);
    expect((await attempt(anna, id)).status).toBe(201);
    expect((await attempt(anna, id)).status).toBe(409);

    const view = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: ben.session }),
    );
    const annaSlot = view.body.battle.videos.slots.find((s) => s.userId === anna.user.id);
    expect(annaSlot?.attempts).toBe(3);
    // Ben does not see Anna's attempts in detail.
    expect(view.body.battle.videos.mine).toEqual([]);
  });

  it('accepts the same attempt twice without counting it twice', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const body = { id: newId(), partIndex: 0, startedAt: Date.now() };
    expect((await post(anna, `/api/battles/${id}/attempts`, body)).status).toBe(201);
    expect((await post(anna, `/api/battles/${id}/attempts`, body)).status).toBe(200);
    // The id belongs to Anna; Ben cannot reuse it.
    expect((await post(ben, `/api/battles/${id}/attempts`, body)).body.error).toBe(
      'attempt_id_taken',
    );
  });

  it('refuses outsiders, unknown parts and attempts after the deadline', async () => {
    const id = await activeBattle();
    expect((await attempt(carla, id)).status).toBe(403);
    expect((await attempt(anna, id, 3)).body.error).toBe('no_such_part');
    await env.DB.prepare('UPDATE battles SET deadline_at = ? WHERE id = ?')
      .bind(Date.now() - 60_000, id)
      .run();
    const late = await attempt(anna, id);
    expect(late.body.error).toBe('deadline_passed');
  });
});

describe('upload, choosing and unlocking', () => {
  it('unlocks both videos once both have chosen', async () => {
    const id = await activeBattle();
    const a = await deliver(anna, id);
    expect(a.battle.status).toBe('active');
    expect(a.battle.videos.unlocked).toBe(false);
    // Before unlocking only the owner can watch.
    expect((await file(anna, a.videoId)).status).toBe(200);
    expect((await file(ben, a.videoId)).status).toBe(404);
    const benSees = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: ben.session }),
    );
    const annaSlot = benSees.body.battle.videos.slots.find((s) => s.userId === anna.user.id);
    expect(annaSlot?.submittedAt).not.toBeNull();
    expect(annaSlot?.videoId).toBeNull();

    const b = await deliver(ben, id);
    expect(b.battle.status).toBe('reviewing');
    expect(b.battle.videos.unlocked).toBe(true);
    expect(b.battle.videos.slots.find((s) => s.userId === anna.user.id)?.videoId).toBe(a.videoId);
    const res = await file(ben, a.videoId);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    // Other logged-in users may watch public videos that count.
    expect((await file(carla, a.videoId)).status).toBe(200);
    // Changing the choice is no longer possible.
    expect(
      (await post(anna, `/api/battles/${id}/submissions`, { videoId: a.videoId })).status,
    ).toBe(409);
  });

  it('keeps attempts that do not count private, and allows changing the choice', async () => {
    const id = await activeBattle();
    const first = await deliver(anna, id);
    const second = await deliver(anna, id);
    const view = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: anna.session }),
    );
    const counting = view.body.battle.videos.mine.filter((m) => m.video?.counts);
    expect(counting.map((m) => m.video?.id)).toEqual([second.videoId]);
    await deliver(ben, id);
    expect((await file(ben, second.videoId)).status).toBe(200);
    expect((await file(ben, first.videoId)).status).toBe(404);
  });

  it('serves byte ranges so videos can be seeked', async () => {
    const id = await activeBattle();
    const { videoId } = await deliver(anna, id);
    const res = await file(anna, videoId, { Range: 'bytes=1-2' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 1-2/5');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([2, 3]));
  });

  it('checks the stored file before accepting an upload', async () => {
    const id = await activeBattle();
    const res = await attempt(anna, id);
    const attemptId = res.body.battle.videos.mine[0]?.id as string;
    const created = await post<{ video: { id: string } }>(anna, '/api/videos', {
      attemptId,
      contentType: 'video/mp4',
      sizeBytes: 10,
    });
    const complete = `/api/videos/${created.body.video.id}/complete`;
    expect((await post(anna, complete)).body.error).toBe('upload_missing');
    await env.VIDEOS.put(`videos/${created.body.video.id}/original.mp4`, new Uint8Array(3));
    expect((await post(anna, complete)).body.error).toBe('upload_incomplete');
    // Not uploaded yet: cannot be chosen.
    const submit = await post(anna, `/api/battles/${id}/submissions`, {
      videoId: created.body.video.id,
    });
    expect(submit.body.error).toBe('not_uploaded_yet');
    // Only the owner can announce an upload for an attempt.
    const foreign = await post(ben, '/api/videos', {
      attemptId,
      contentType: 'video/mp4',
      sizeBytes: 10,
    });
    expect(foreign.status).toBe(404);
  });
});

describe('extra attempt request with a video', () => {
  it('only accepts an uploaded video of my own', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const res = await attempt(anna, id);
    const attemptId = res.body.battle.videos.mine[0]?.id as string;
    const announced = await post<{ video: { id: string } }>(anna, '/api/videos', {
      attemptId,
      contentType: 'video/mp4',
      sizeBytes: 5,
    });
    const ask = (who: Person) =>
      post(who, `/api/battles/${id}/proposals`, {
        kind: 'extra_attempt',
        change: 1,
        videoId: announced.body.video.id,
      });
    expect((await ask(anna)).body.error).toBe('not_uploaded_yet');
    expect((await ask(ben)).body.error).toBe('video_not_found');
  });

  it('lets the opponent watch the video and grants the attempt on acceptance', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const res = await attempt(anna, id);
    const attemptId = res.body.battle.videos.mine[0]?.id as string;
    const videoId = await upload(anna, attemptId);
    expect((await file(ben, videoId)).status).toBe(404);

    const proposed = await post(anna, `/api/battles/${id}/proposals`, {
      kind: 'extra_attempt',
      change: 1,
      videoId,
    });
    expect(proposed.status).toBe(201);
    const benView = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: ben.session }),
    );
    expect(benView.body.battle.videos.sharedWithMe.map((v) => v.id)).toEqual([videoId]);
    expect((await file(ben, videoId)).status).toBe(200);

    const proposalId = proposed.body.battle.proposals[0]?.id as string;
    const accepted = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(
      accepted.body.battle.participants.find((p) => p.userId === anna.user.id)?.extraAttempts,
    ).toBe(1);
    expect((await attempt(anna, id)).status).toBe(201);
  });
});

describe('storage', () => {
  it('signs direct R2 URLs when an access key is configured', async () => {
    const store = videoStore({
      ...env,
      R2_ACCESS_KEY_ID: 'key-id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_ACCOUNT_ID: 'account',
    });
    const target = await store.uploadTarget('videos/x/original.mp4', 'video/mp4', 'x');
    const url = new URL(target.url);
    expect(url.host).toBe('account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/hfb-videos/videos/x/original.mp4');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    const served = await store.serve('videos/x/original.mp4', new Request('http://localhost/'));
    expect(served.status).toBe(302);
    expect(served.headers.get('Location')).toContain('X-Amz-Signature=');
  });

  it('removes files of uploads that were never completed', async () => {
    const id = await activeBattle();
    const res = await attempt(anna, id);
    const attemptId = res.body.battle.videos.mine[0]?.id as string;
    const created = await post<{ video: { id: string } }>(anna, '/api/videos', {
      attemptId,
      contentType: 'video/webm',
      sizeBytes: 3,
    });
    const key = `videos/${created.body.video.id}/original.webm`;
    await env.VIDEOS.put(key, new Uint8Array(3));
    const db = getDb(env.DB);
    expect(await removeStaleUploads(db, videoStore(env))).toBe(0);
    expect(await removeStaleUploads(db, videoStore(env), Date.now() + STALE_UPLOAD_MS + 1)).toBe(1);
    expect(await env.VIDEOS.head(key)).toBeNull();
  });
});

describe('canViewVideo', () => {
  const base = {
    viewerId: 'viewer',
    ownerId: 'owner',
    isParticipant: true,
    submitted: true,
    unlocked: true,
    visibility: 'public' as const,
    sharedWithOpponent: false,
  };
  it('follows the visibility rules', () => {
    expect(canViewVideo(base)).toBe(true);
    expect(canViewVideo({ ...base, viewerId: null })).toBe(false);
    expect(canViewVideo({ ...base, unlocked: false })).toBe(false);
    expect(canViewVideo({ ...base, submitted: false })).toBe(false);
    expect(canViewVideo({ ...base, unlocked: false, sharedWithOpponent: true })).toBe(true);
    expect(canViewVideo({ ...base, isParticipant: false, visibility: 'review_only' })).toBe(false);
    expect(canViewVideo({ ...base, isParticipant: false, visibility: 'logged_in' })).toBe(true);
    expect(canViewVideo({ ...base, viewerId: 'owner', submitted: false, unlocked: false })).toBe(
      true,
    );
  });
});

describe('attemptsLeft', () => {
  const used = (entries: [string, number][]) => new Map(entries);
  it('gives every part its attempts and shares extra attempts across parts', () => {
    expect(attemptsLeft(null, 0, used([['0:1', 50]]), '0:1')).toBeNull();
    expect(attemptsLeft(3, 0, used([]), '0:1')).toBe(3);
    expect(attemptsLeft(3, 0, used([['0:1', 3]]), '0:1')).toBe(0);
    expect(attemptsLeft(3, 0, used([['0:1', 3]]), '1:1')).toBe(3);
    // One extra attempt, used up in part 0: none left for part 1 beyond its own three.
    expect(attemptsLeft(3, 1, used([['0:1', 3]]), '0:1')).toBe(1);
    expect(attemptsLeft(3, 1, used([['0:1', 4]]), '0:1')).toBe(0);
    expect(attemptsLeft(3, 1, used([['0:1', 4]]), '1:1')).toBe(3);
  });
});
