import { env } from 'cloudflare:workers';
import { newId, UPLOAD_PART_BYTES } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let admin: Person;
let anna: Person;
let ben: Person;

interface FriendInfo {
  name: string | null;
}
interface Battle {
  id: string;
  videos: {
    mine: {
      id: string;
      friend: FriendInfo | null;
      video: { id: string; counts: boolean } | null;
    }[];
    byFriends: { id: string; userId: string; friend: FriendInfo }[];
  };
}

beforeEach(async () => {
  admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

/** A call as a friend without an account (no session). */
const guest = <T = { error?: string }>(path: string, body: unknown) =>
  json<T & { error?: string }>(call(path, { method: 'POST', body }));
const as = <T = { error?: string }>(who: Person, path: string, body?: unknown) =>
  json<T & { error?: string }>(call(path, { method: 'POST', session: who.session, body }));

async function codeOf(who: Person) {
  return (await json<{ code: string }>(call('/api/athlete-code', { session: who.session }))).body
    .code;
}

async function activeBattle(settings: Record<string, unknown> = {}) {
  const res = await as<{ battle: { id: string } }>(anna, '/api/battles', {
    formatId: BEST_TRICK,
    settings,
  });
  await as(ben, `/api/battles/${res.body.battle.id}/accept`);
  return res.body.battle.id;
}

const battle = async (who: Person, id: string) =>
  (await json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: who.session }))).body
    .battle;

const app = createApp();

/** Uploads like a friend's phone without R2 access keys: through the Worker, with the code. */
async function guestUpload(code: string, attemptId: string) {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const created = await guest<{
    video: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>('/api/guest/videos', {
    code,
    attemptId,
    contentType: 'video/mp4',
    sizeBytes: bytes.length,
    visibility: 'review_only',
  });
  expect(created.status, created.body.error).toBe(201);
  const { url, headers } = created.body.upload;
  expect(url).toBe(`/api/guest/videos/${created.body.video.id}/upload`);
  const put = await app.request(
    url,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Length': '5', Origin: 'http://localhost' },
      body: bytes,
    },
    env,
  );
  expect(put.status).toBe(200);
  const done = await guest<{ video: { status: string } }>(
    `/api/guest/videos/${created.body.video.id}/complete`,
    { code },
  );
  expect(done.body.video.status).toBe('uploaded');
  return created.body.video.id;
}

describe('athlete code', () => {
  it('starts random, can be chosen freely and renewed; the old one stops working', async () => {
    const code = await codeOf(anna);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(await codeOf(anna)).toBe(code);
    // Case, spaces and dashes do not matter when a friend types it.
    const lookup = await guest<{ athlete: { displayName: string } }>('/api/guest/lookup', {
      code: code.toLowerCase().replace('-', ' '),
    });
    expect(lookup.body.athlete.displayName).toBe('anna');

    const put = (who: Person, code: string) =>
      json<{ code: string; error?: string }>(
        call('/api/athlete-code', { method: 'PUT', session: who.session, body: { code } }),
      );
    const chosen = await put(anna, ' Anna Flips! ');
    expect(chosen.body.code).toBe('Anna Flips!');
    expect((await guest('/api/guest/lookup', { code })).status).toBe(404);
    expect((await guest('/api/guest/lookup', { code: 'annaflips!' })).status).toBe(200);
    // Only one athlete can have a code (compared without case, spaces and dashes).
    expect((await put(ben, 'ANNA-FLIPS!')).body.error).toBe('code_taken');
    expect((await put(ben, '  ')).status).toBe(400);

    const renewed = await as<{ code: string }>(anna, '/api/athlete-code/renew');
    expect(renewed.body.code).toMatch(/^\w{4}-\w{4}$/);
    expect((await guest('/api/guest/lookup', { code: 'Anna Flips!' })).status).toBe(404);
  });
});

describe('filming by friends, online', () => {
  it('films into a running battle: counts as the athlete’s attempt, the opponent sees who filmed', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    const code = await codeOf(anna);
    const lookup = await guest<{
      battles: { id: string; opponents: string[]; attemptsLeft: (number | null)[] }[];
    }>('/api/guest/lookup', { code });
    expect(lookup.body.battles).toEqual([
      expect.objectContaining({ id, opponents: ['ben'], attemptsLeft: [1] }),
    ]);

    const attemptId = newId();
    const started = await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
      recorderName: 'Max',
    });
    expect(started.status, started.body.error).toBe(201);
    // The attempt limit applies as for the athlete: beyond it, the attempt is provisional.
    const secondId = newId();
    const second = await guest('/api/guest/attempts', {
      code,
      id: secondId,
      battleId: id,
      partIndex: 0,
      startedAt: Date.now() + 1,
    });
    expect(second.status, second.body.error).toBe(201);

    const videoId = await guestUpload(code, attemptId);
    const mine = (await battle(anna, id)).videos.mine;
    expect(mine).toEqual([
      expect.objectContaining({
        id: attemptId,
        provisional: false,
        friend: { name: 'Max' },
        video: expect.objectContaining({ id: videoId }),
      }),
      expect.objectContaining({ id: secondId, provisional: true }),
    ]);
    expect((await battle(ben, id)).videos.byFriends).toEqual([
      expect.objectContaining({ id: attemptId, userId: anna.user.id }),
      expect.objectContaining({ id: secondId, userId: anna.user.id }),
    ]);
    const chosen = await as(anna, `/api/battles/${id}/submissions`, { videoId });
    expect(chosen.status, chosen.body.error).toBe(200);
  });

  it('a wrong code or someone else’s battle is refused', async () => {
    const id = await activeBattle();
    expect((await guest('/api/guest/lookup', { code: 'ABCD-EFGH' })).status).toBe(404);
    const carla = await registerAthlete('carla', admin.session);
    const res = await guest('/api/guest/attempts', {
      code: await codeOf(carla),
      id: newId(),
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
    });
    expect(res.status).toBe(404);
  });
});

describe('filming by friends, upload in parts', () => {
  it('sends a big video in parts with the code', async () => {
    const id = await activeBattle();
    const code = await codeOf(anna);
    const attemptId = newId();
    await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
    });
    const size = UPLOAD_PART_BYTES + 3;
    const created = await guest<{
      video: { id: string };
      multipart: { uploadId: string; partCount: number };
    }>('/api/guest/videos', { code, attemptId, contentType: 'video/mp4', sizeBytes: size });
    const { uploadId, partCount } = created.body.multipart;
    expect(partCount).toBe(2);
    const videoId = created.body.video.id;
    const targets = await guest<{
      parts: {
        partNumber: number;
        size: number;
        target: { url: string; headers: Record<string, string> };
      }[];
    }>(`/api/guest/videos/${videoId}/parts`, { code, uploadId, partNumbers: [1, 2] });
    const parts = [];
    for (const p of targets.body.parts) {
      expect(p.target.url).toBe(`/api/guest/videos/${videoId}/parts/${p.partNumber}`);
      const res = await app.request(
        p.target.url,
        {
          method: 'PUT',
          headers: {
            ...p.target.headers,
            'Content-Length': String(p.size),
            Origin: 'http://localhost',
          },
          body: new Uint8Array(p.size),
        },
        env,
      );
      expect(res.status).toBe(200);
      parts.push({ partNumber: p.partNumber, etag: res.headers.get('ETag') as string });
    }
    // Another code cannot finish it.
    const foreign = await guest(`/api/guest/videos/${videoId}/complete`, {
      code: await codeOf(ben),
      uploadId,
      parts,
    });
    expect(foreign.status).toBe(404);
    const done = await guest<{ video: { status: string } }>(
      `/api/guest/videos/${videoId}/complete`,
      { code, uploadId, parts },
    );
    expect(done.body.video.status).toBe('uploaded');
    expect((await env.VIDEOS.head(`videos/${videoId}/original.mp4`))?.size).toBe(size);
  });
});

describe('video settings', () => {
  it('the owner changes who may watch a video a friend filmed', async () => {
    const id = await activeBattle();
    const code = await codeOf(anna);
    const attemptId = newId();
    await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
    });
    const videoId = await guestUpload(code, attemptId);
    const settings = await as<{ video: { visibility: string } }>(
      anna,
      `/api/videos/${videoId}/settings`,
      { visibility: 'logged_in', retention: 'delete_after_battle' },
    );
    expect(settings.body.video.visibility).toBe('logged_in');
    const notMine = await as(ben, `/api/videos/${videoId}/settings`, {
      visibility: 'public',
      retention: 'keep',
    });
    expect(notMine.status).toBe(404);
  });

  it('without a battle there is nothing to film for', async () => {
    const res = await guest('/api/guest/attempts', {
      code: await codeOf(anna),
      id: newId(),
      battleId: null,
      partIndex: 0,
      startedAt: Date.now(),
    });
    expect(res.status).toBe(400);
  });
});
