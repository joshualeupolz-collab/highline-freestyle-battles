import { env } from 'cloudflare:workers';
import { newId } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { getDb } from '../src/db/client';
import { INBOX_KEEP_DAYS, markOldInboxVideos } from '../src/services/friendVideos';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let admin: Person;
let anna: Person;
let ben: Person;

interface FriendInfo {
  name: string | null;
  description: string | null;
  assignment: string;
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
  it('is created once, can be renewed, and the old one stops working', async () => {
    const code = await codeOf(anna);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(await codeOf(anna)).toBe(code);

    const lookup = await guest<{ athlete: { displayName: string } }>('/api/guest/lookup', {
      code: code.toLowerCase().replace('-', ' '),
    });
    expect(lookup.body.athlete.displayName).toBe('anna');

    const renewed = await as<{ code: string }>(anna, '/api/athlete-code/renew');
    expect(renewed.body.code).not.toBe(code);
    expect((await guest('/api/guest/lookup', { code })).status).toBe(404);
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
    // The attempt limit applies as for the athlete.
    const second = await guest('/api/guest/attempts', {
      code,
      id: newId(),
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
    });
    expect(second.body.error).toBe('no_attempts_left');

    const videoId = await guestUpload(code, attemptId);
    const mine = (await battle(anna, id)).videos.mine;
    expect(mine).toEqual([
      expect.objectContaining({
        id: attemptId,
        friend: { name: 'Max', description: null, assignment: 'direct' },
        video: expect.objectContaining({ id: videoId }),
      }),
    ]);
    expect((await battle(ben, id)).videos.byFriends).toEqual([
      expect.objectContaining({ id: attemptId, userId: anna.user.id }),
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

describe('filming by friends, offline', () => {
  it('goes to the inbox, is assigned later and counts once the opponent confirmed it', async () => {
    const id = await activeBattle();
    const code = await codeOf(anna);
    const attemptId = newId();
    const noText = await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: null,
      partIndex: 0,
      startedAt: Date.now(),
    });
    expect(noText.body.error).toBe('description_required');
    const started = await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: null,
      partIndex: 0,
      startedAt: Date.now(),
      description: 'Best trick vs Ben',
    });
    expect(started.status).toBe(201);
    const videoId = await guestUpload(code, attemptId);

    const inbox = await json<{
      inbox: { id: string; description: string; battles: { id: string }[] }[];
    }>(call('/api/videos/inbox', { session: anna.session }));
    expect(inbox.body.inbox).toEqual([
      expect.objectContaining({
        id: attemptId,
        description: 'Best trick vs Ben',
        battles: [expect.objectContaining({ id })],
      }),
    ]);

    // Back online, the friend assigns it.
    const assigned = await guest(`/api/guest/attempts/${attemptId}/assign`, {
      code,
      battleId: id,
      partIndex: 0,
    });
    expect(assigned.status, assigned.body.error).toBe(200);
    expect(
      (await json<{ inbox: unknown[] }>(call('/api/videos/inbox', { session: anna.session }))).body
        .inbox,
    ).toEqual([]);

    // Not before the opponent confirmed it.
    const early = await as(anna, `/api/battles/${id}/submissions`, { videoId });
    expect(early.body.error).toBe('assignment_unconfirmed');
    const benBattles = await json<{
      battles: { id: string; todo: { assignmentForMe: boolean } }[];
    }>(call('/api/battles/mine', { session: ben.session }));
    expect(benBattles.body.battles.find((b) => b.id === id)?.todo.assignmentForMe).toBe(true);
    expect((await battle(ben, id)).videos.byFriends[0]?.friend).toEqual({
      name: null,
      description: 'Best trick vs Ben',
      assignment: 'pending',
    });
    // The athlete cannot confirm it alone.
    const self = await as(anna, `/api/battles/${id}/assignments/${attemptId}`, {
      action: 'confirm',
    });
    expect(self.status).toBe(403);
    const confirmed = await as(ben, `/api/battles/${id}/assignments/${attemptId}`, {
      action: 'confirm',
    });
    expect(confirmed.status, confirmed.body.error).toBe(200);
    const chosen = await as(anna, `/api/battles/${id}/submissions`, { videoId });
    expect(chosen.status, chosen.body.error).toBe(200);
  });

  it('a rejected assignment goes back to the inbox; old recordings do not fit', async () => {
    const id = await activeBattle();
    const code = await codeOf(anna);
    const before = newId();
    await guest('/api/guest/attempts', {
      code,
      id: before,
      battleId: null,
      partIndex: 0,
      startedAt: Date.now() - 86_400_000,
      description: 'yesterday',
    });
    const wrongTime = await as(anna, `/api/videos/inbox/${before}/assign`, {
      battleId: id,
      partIndex: 0,
    });
    expect(wrongTime.body.error).toBe('not_running_then');

    const attemptId = newId();
    await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: null,
      partIndex: 0,
      startedAt: Date.now(),
      description: 'today',
    });
    const assigned = await as(anna, `/api/videos/inbox/${attemptId}/assign`, {
      battleId: id,
      partIndex: 0,
    });
    expect(assigned.status, assigned.body.error).toBe(200);
    const rejected = await as(ben, `/api/battles/${id}/assignments/${attemptId}`, {
      action: 'reject',
    });
    expect(rejected.status).toBe(200);
    const inbox = await json<{ inbox: { id: string }[] }>(
      call('/api/videos/inbox', { session: anna.session }),
    );
    expect(inbox.body.inbox.map((i) => i.id).sort()).toEqual([before, attemptId].sort());

    // Deleting from the inbox.
    expect((await as(anna, `/api/videos/inbox/${before}/delete`)).status).toBe(200);
    const after = await json<{ inbox: { id: string }[] }>(
      call('/api/videos/inbox', { session: anna.session }),
    );
    expect(after.body.inbox.map((i) => i.id)).toEqual([attemptId]);
  });

  it('inbox videos nobody assigned are deleted after a while; the owner can change settings', async () => {
    const code = await codeOf(anna);
    const attemptId = newId();
    await guest('/api/guest/attempts', {
      code,
      id: attemptId,
      battleId: null,
      partIndex: 0,
      startedAt: Date.now(),
      description: 'training',
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

    const db = getDb(env.DB);
    expect(await markOldInboxVideos(db)).toBe(0);
    expect(await markOldInboxVideos(db, Date.now() + (INBOX_KEEP_DAYS + 1) * 86_400_000)).toBe(1);
  });
});
