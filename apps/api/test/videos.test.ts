import { env } from 'cloudflare:workers';
import {
  attemptsLeft,
  newId,
  type SettleAttempt,
  settleAttempts,
  UPLOAD_PART_BYTES,
} from '@hfb/shared';
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
  provisional: number;
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
    mine: {
      id: string;
      provisional: boolean;
      video: { id: string; status: string; counts: boolean } | null;
    }[];
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
  it('counts attempts per part; beyond the limit they are provisional', async () => {
    const id = await activeBattle({ attemptsPerVideo: 2 });
    const t0 = Date.now();
    const at = (n: number) =>
      post(anna, `/api/battles/${id}/attempts`, { id: newId(), partIndex: 0, startedAt: t0 + n });
    expect((await at(1)).status).toBe(201);
    expect((await at(2)).status).toBe(201);
    const third = await at(3);
    expect(third.status).toBe(201);
    expect(third.body.battle.videos.mine.map((m) => m.provisional)).toEqual([false, false, true]);
    expect((await at(4)).status).toBe(201);

    // A provisional attempt cannot be chosen.
    const mine = (
      await json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: anna.session }))
    ).body.battle.videos.mine;
    const videoId = await upload(anna, mine[2]?.id as string);
    const refused = await post(anna, `/api/battles/${id}/submissions`, { videoId });
    expect(refused.body.error).toBe('attempt_provisional');

    // Goodwill: one extra attempt makes the earliest provisional attempt valid.
    const granted = await post(ben, `/api/battles/${id}/grant-attempt`);
    expect(granted.body.battle.videos.mine).toEqual([]);
    const view = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: anna.session }),
    );
    expect(view.body.battle.videos.mine.map((m) => m.provisional)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect((await post(anna, `/api/battles/${id}/submissions`, { videoId })).status).toBe(200);

    // Taking the extra attempt back: the chosen one stays valid, the latest other one that was
    // valid becomes provisional again.
    const takeBack = await post(ben, `/api/battles/${id}/proposals`, {
      kind: 'extra_attempt',
      change: -1,
    });
    const proposalId = takeBack.body.battle.proposals[0]?.id as string;
    await post(anna, `/api/battles/${id}/proposals/${proposalId}/respond`, { decision: 'accept' });

    const benView = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: ben.session }),
    );
    const annaSlot = benView.body.battle.videos.slots.find((s) => s.userId === anna.user.id);
    expect(annaSlot?.attempts).toBe(4);
    expect(annaSlot?.provisional).toBe(2);
    // Ben does not see Anna's attempts in detail.
    expect(benView.body.battle.videos.mine).toEqual([]);
  });

  it('re-checks provisional attempts when the number of attempts changes', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const t0 = Date.now();
    for (const n of [1, 2, 3])
      await post(anna, `/api/battles/${id}/attempts`, {
        id: newId(),
        partIndex: 0,
        startedAt: t0 + n,
      });
    const view = async () =>
      (
        await json<{ battle: Battle & { videos: { free: (number | null)[] } } }>(
          call(`/api/battles/${id}`, { session: anna.session }),
        )
      ).body.battle.videos;
    expect((await view()).free).toEqual([0]);

    const proposed = await post(anna, `/api/battles/${id}/proposals`, {
      kind: 'settings',
      changes: { attemptsPerVideo: 4 },
    });
    const proposalId = proposed.body.battle.proposals[0]?.id as string;
    await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, { decision: 'accept' });
    const after = await view();
    expect(after.mine.map((m) => m.provisional)).toEqual([false, false, false]);
    expect(after.free).toEqual([1]);

    // Room that appeared without a re-check (e.g. changed directly in the database) is noticed
    // when the battle is shown.
    await env.DB.prepare('UPDATE battles SET attempts_per_video = 5 WHERE id = ?').bind(id).run();
    await post(anna, `/api/battles/${id}/attempts`, {
      id: newId(),
      partIndex: 0,
      startedAt: t0 + 4,
    });
    await post(anna, `/api/battles/${id}/attempts`, {
      id: newId(),
      partIndex: 0,
      startedAt: t0 + 5,
    });
    await env.DB.prepare('UPDATE battles SET attempts_per_video = 6 WHERE id = ?').bind(id).run();
    const healed = await view();
    expect(healed.mine.every((m) => !m.provisional)).toBe(true);
    expect(healed.free).toEqual([1]);
  });

  it('removes a recording shorter than 3 seconds, not an uploaded one', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const t0 = Date.now();
    const first = newId();
    const second = newId();
    await post(anna, `/api/battles/${id}/attempts`, { id: first, partIndex: 0, startedAt: t0 });
    await post(anna, `/api/battles/${id}/attempts`, {
      id: second,
      partIndex: 0,
      startedAt: t0 + 1,
    });
    // A pending upload of the short one is removed with it; the provisional one moves up.
    await post(anna, '/api/videos', { attemptId: first, contentType: 'video/mp4', sizeBytes: 5 });
    expect((await post(ben, `/api/battles/${id}/attempts/${first}/discard`)).status).toBe(404);
    const res = await post(anna, `/api/battles/${id}/attempts/${first}/discard`);
    expect(res.status, res.body.error).toBe(200);
    expect(res.body.battle.videos.mine.map((m) => [m.id, m.provisional])).toEqual([
      [second, false],
    ]);
    const chat = await json<{ messages: { event: { type: string } | null }[] }>(
      call(`/api/battles/${id}/messages`, { session: ben.session }),
    );
    expect(chat.body.messages.some((m) => m.event?.type === 'attempt_discarded')).toBe(true);

    await upload(anna, second);
    const refused = await post(anna, `/api/battles/${id}/attempts/${second}/discard`);
    expect(refused.body.error).toBe('already_uploaded');
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
  it('refuses a provisional attempt (it would not have counted anyway)', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const t0 = Date.now();
    for (const n of [1, 2])
      await post(anna, `/api/battles/${id}/attempts`, {
        id: newId(),
        partIndex: 0,
        startedAt: t0 + n,
      });
    const mine = (
      await json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: anna.session }))
    ).body.battle.videos.mine;
    const videoId = await upload(anna, mine[1]?.id as string);
    const res = await post(anna, `/api/battles/${id}/proposals`, {
      kind: 'extra_attempt',
      change: 1,
      videoId,
    });
    expect(res.body.error).toBe('attempt_provisional');
  });

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

describe('upload in parts', () => {
  const size = UPLOAD_PART_BYTES + 5;
  const bytes = new Uint8Array(size).map((_, i) => i % 251);

  interface Announced {
    video: { id: string };
    multipart: { uploadId: string; partBytes: number; partCount: number } | null;
    error?: string;
  }
  interface Targets {
    parts: {
      partNumber: number;
      size: number;
      target: { url: string; headers: Record<string, string> };
    }[];
    error?: string;
  }

  async function announce(attemptId: string, sizeBytes = size) {
    const res = await post<Announced>(anna, '/api/videos', {
      attemptId,
      contentType: 'video/mp4',
      sizeBytes,
    });
    expect(res.status, res.body.error).toBeLessThan(300);
    return res.body;
  }

  async function sendPart(
    target: Targets['parts'][number]['target'],
    body: Uint8Array,
  ): Promise<Response> {
    return app.request(
      target.url,
      {
        method: 'PUT',
        headers: {
          ...target.headers,
          'Content-Length': String(body.length),
          Cookie: `hfb_session=${anna.session}`,
          Origin: 'http://localhost',
        },
        body,
      },
      env,
    );
  }

  async function newAttempt() {
    const id = await activeBattle();
    const res = await attempt(anna, id);
    return { battleId: id, attemptId: res.body.battle.videos.mine[0]?.id as string };
  }

  it('sends big videos in parts and continues where it stopped', async () => {
    const { attemptId } = await newAttempt();
    const first = await announce(attemptId);
    expect(first.multipart).toEqual({
      uploadId: expect.any(String),
      partBytes: UPLOAD_PART_BYTES,
      partCount: 2,
    });
    const uploadId = first.multipart?.uploadId as string;
    const videoId = first.video.id;
    const targets = await post<Targets>(anna, `/api/videos/${videoId}/parts`, {
      uploadId,
      partNumbers: [2, 1],
    });
    expect(targets.body.parts.map((p) => [p.partNumber, p.size])).toEqual([
      [1, UPLOAD_PART_BYTES],
      [2, 5],
    ]);
    const [one, two] = targets.body.parts;
    if (!one || !two) throw new Error('missing targets');
    expect(one.target.url).toBe(`/api/videos/${videoId}/parts/1`);

    // A part of the wrong size is refused.
    const wrong = await sendPart(two.target, new Uint8Array(4));
    expect(wrong.status).toBe(400);
    const sent1 = await sendPart(one.target, bytes.subarray(0, UPLOAD_PART_BYTES));
    expect(sent1.status).toBe(200);
    const etag1 = sent1.headers.get('ETag') as string;
    expect(etag1).toMatch(/^".+"$/);

    // Connection lost; announcing the same file again keeps the upload and its parts.
    const again = await announce(attemptId);
    expect(again.multipart?.uploadId).toBe(uploadId);
    const missing = await post<Targets>(anna, `/api/videos/${videoId}/parts`, {
      uploadId,
      partNumbers: [2],
    });
    const sent2 = await sendPart(
      missing.body.parts[0]?.target as Targets['parts'][number]['target'],
      bytes.subarray(UPLOAD_PART_BYTES),
    );
    const etag2 = ((await sent2.json()) as { etag: string }).etag;

    const complete = `/api/videos/${videoId}/complete`;
    const incomplete = await post(anna, complete, {
      uploadId,
      parts: [{ partNumber: 1, etag: etag1 }],
    });
    expect(incomplete.body.error).toBe('upload_parts_missing');
    const done = await post<{ video: { status: string } }>(anna, complete, {
      uploadId,
      parts: [
        { partNumber: 2, etag: etag2 },
        { partNumber: 1, etag: etag1 },
      ],
    });
    expect(done.body.video.status).toBe('uploaded');
    const stored = await env.VIDEOS.get(`videos/${videoId}/original.mp4`);
    const back = new Uint8Array(await (stored as R2ObjectBody).arrayBuffer());
    // Comparing 6 MB with toEqual takes too long; the length and the bytes at the seam do.
    expect(back.length).toBe(size);
    expect([...back.subarray(UPLOAD_PART_BYTES - 3, UPLOAD_PART_BYTES + 3)]).toEqual([
      ...bytes.subarray(UPLOAD_PART_BYTES - 3, UPLOAD_PART_BYTES + 3),
    ]);
    expect(stored?.httpMetadata?.contentType).toBe('video/mp4');
  });

  it('starts over when the file changed or a part is unknown', async () => {
    const { attemptId } = await newAttempt();
    const first = await announce(attemptId);
    const changed = await announce(attemptId, size + 1);
    expect(changed.multipart?.uploadId).not.toBe(first.multipart?.uploadId);
    // The old upload id is no longer valid.
    const old = await post(anna, `/api/videos/${first.video.id}/parts`, {
      uploadId: first.multipart?.uploadId,
      partNumbers: [1],
    });
    expect(old.body.error).toBe('upload_restarted');
    // ETags R2 does not know: the upload is dropped and must be announced again.
    const bad = await post(anna, `/api/videos/${first.video.id}/complete`, {
      uploadId: changed.multipart?.uploadId,
      parts: [
        { partNumber: 1, etag: 'nope' },
        { partNumber: 2, etag: 'nope' },
      ],
    });
    expect(bad.body.error).toBe('upload_restarted');
    const renewed = await announce(attemptId, size + 1);
    expect(renewed.multipart?.uploadId).toBeTruthy();
    expect(renewed.multipart?.uploadId).not.toBe(changed.multipart?.uploadId);
  });

  it('keeps small videos a single upload', async () => {
    const { attemptId } = await newAttempt();
    expect((await announce(attemptId, UPLOAD_PART_BYTES)).multipart).toBeNull();
  });

  it('signs direct part URLs when an access key is configured', async () => {
    const store = videoStore({
      ...env,
      R2_ACCESS_KEY_ID: 'key-id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_ACCOUNT_ID: 'account',
    });
    const target = await store.partTarget('videos/x/original.mp4', 'abc', 3, 'x');
    const url = new URL(target.url);
    expect(url.pathname).toBe('/hfb-videos/videos/x/original.mp4');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('abc');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aborts unfinished uploads in parts after two days', async () => {
    const { attemptId } = await newAttempt();
    const first = await announce(attemptId);
    const db = getDb(env.DB);
    expect(await removeStaleUploads(db, videoStore(env), Date.now() + STALE_UPLOAD_MS + 1)).toBe(1);
    const parts = await post(anna, `/api/videos/${first.video.id}/parts`, {
      uploadId: first.multipart?.uploadId,
      partNumbers: [1],
    });
    expect(parts.body.error).toBe('upload_restarted');
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

describe('settleAttempts', () => {
  const a = (id: string, slot: string, startedAt: number, more: Partial<SettleAttempt> = {}) => ({
    id,
    slot,
    startedAt,
    provisional: true,
    covered: false,
    submitted: false,
    ...more,
  });
  it('makes the first attempts valid in start order, shares extra attempts', () => {
    const list = [a('x3', '0:1', 3), a('x1', '0:1', 1), a('x2', '0:1', 2), a('y1', '1:1', 4)];
    expect(Object.fromEntries(settleAttempts(2, 0, new Map(), list))).toEqual({
      x1: false,
      x2: false,
      y1: false,
    });
    expect(settleAttempts(2, 1, new Map(), list).get('x3')).toBe(false);
    expect(settleAttempts(null, 0, new Map(), list).size).toBe(4);
  });
  it('never replaces a valid attempt by one that arrives later with an earlier start', () => {
    const list = [a('late', '0:1', 1), a('valid', '0:1', 2, { provisional: false })];
    expect(settleAttempts(1, 0, new Map(), list).size).toBe(0);
  });
  it('counts reserved units and covered attempts', () => {
    const reserved = new Map([['0:1', 2]]);
    const list = [a('c', '0:1', 1, { covered: true }), a('n', '0:1', 2)];
    expect(Object.fromEntries(settleAttempts(3, 0, reserved, list))).toEqual({
      c: false,
      n: false,
    });
    expect(Object.fromEntries(settleAttempts(2, 0, reserved, list))).toEqual({ c: false });
  });
  it('takes back the latest valid attempt that was not chosen', () => {
    const list = [
      a('1', '0:1', 1, { provisional: false }),
      a('2', '0:1', 2, { provisional: false, submitted: true }),
      a('3', '0:1', 3, { provisional: false }),
    ];
    expect(Object.fromEntries(settleAttempts(2, 0, new Map(), list))).toEqual({ '3': true });
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
