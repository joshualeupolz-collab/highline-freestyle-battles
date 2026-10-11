import { env } from 'cloudflare:workers';
import { newId } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { getDb } from '../src/db/client';
import {
  computeReplay,
  REPLAY_QUERIES,
  type ReplayRows,
  replayStatements,
} from '../src/services/replay';
import {
  deleteFilesOfDeletedVideos,
  markUnneededVideos,
  VIDEO_CLEANUP_DAYS,
} from '../src/services/videos';
import { videoStore } from '../src/storage/videoStore';
import { call, PASSWORD, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const DAY = 86_400_000;

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let admin: Person;
let anna: Person;
let ben: Person;

beforeEach(async () => {
  admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

interface Battle {
  id: string;
  status: string;
  decisionReason: string | null;
  cancelReason: string | null;
  participants: { userId: string; displayName: string; score: number | null }[];
  videos: { mine: { id: string; video: { id: string } | null }[] };
}

const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

const get = (who: Person, id: string) =>
  json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: who.session }));

async function activeBattle() {
  const created = await post(anna, '/api/battles', { formatId: BEST_TRICK });
  await post(ben, `/api/battles/${created.body.battle.id}/accept`);
  return created.body.battle.id;
}

/** Records and uploads one attempt through the Worker; returns the video id. */
async function uploadAttempt(who: Person, battleId: string, extra: Record<string, unknown> = {}) {
  const res = await post(who, `/api/battles/${battleId}/attempts`, {
    id: newId(),
    partIndex: 0,
    startedAt: Date.now(),
  });
  const attemptId = res.body.battle.videos.mine.at(-1)?.id as string;
  const created = await json<{ video: { id: string } }>(
    call('/api/videos', {
      session: who.session,
      body: { attemptId, contentType: 'video/mp4', sizeBytes: 3, ...extra },
    }),
  );
  const videoId = created.body.video.id;
  await createApp().request(
    `/api/videos/${videoId}/upload`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '3',
        Cookie: `hfb_session=${who.session}`,
        Origin: 'http://localhost',
      },
      body: new Uint8Array([1, 2, 3]),
    },
    env,
  );
  await post(who, `/api/videos/${videoId}/complete`);
  return videoId;
}

const videoStatus = async (id: string) =>
  (
    await env.DB.prepare('SELECT status FROM videos WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status;

describe('cleaning up videos after a battle', () => {
  it('deletes attempts that did not count and review-only videos, keeps the rest', async () => {
    const id = await activeBattle();
    const notChosen = await uploadAttempt(anna, id);
    const kept = await uploadAttempt(anna, id, { retention: 'keep' });
    const chosen = await uploadAttempt(anna, id);
    await post(anna, `/api/battles/${id}/submissions`, { videoId: chosen });
    const reviewOnly = await uploadAttempt(ben, id, { visibility: 'review_only' });
    await post(ben, `/api/battles/${id}/submissions`, { videoId: reviewOnly });

    const db = getDb(env.DB);
    // Still in review: nothing happens.
    expect(await markUnneededVideos(db, Date.now() + 30 * DAY)).toBe(0);

    await env.DB.prepare("UPDATE battles SET status = 'decided', ended_at = ? WHERE id = ?")
      .bind(Date.now(), id)
      .run();
    expect(await markUnneededVideos(db)).toBe(0); // grace period
    const later = Date.now() + (VIDEO_CLEANUP_DAYS + 1) * DAY;
    expect(await markUnneededVideos(db, later)).toBe(2);
    expect(await videoStatus(notChosen)).toBe('deleted');
    expect(await videoStatus(reviewOnly)).toBe('deleted');
    expect(await videoStatus(kept)).toBe('uploaded');
    expect(await videoStatus(chosen)).toBe('uploaded');

    expect(await deleteFilesOfDeletedVideos(db, videoStore(env))).toBe(2);
    expect(await env.VIDEOS.head(`videos/${notChosen}/original.mp4`)).toBeNull();
    expect(await env.VIDEOS.head(`videos/${chosen}/original.mp4`)).not.toBeNull();
    // Deleted videos cannot be watched any more, not even by the owner.
    expect((await call(`/api/videos/${notChosen}/file`, { session: anna.session })).status).toBe(
      404,
    );
  });
});

describe('deleting an account', () => {
  it('needs the password', async () => {
    const res = await json<{ error: string }>(
      call('/api/auth/delete-account', {
        session: anna.session,
        body: { password: `${PASSWORD}-but-not-this` },
      }),
    );
    expect(res.body.error).toBe('wrong_password');
  });

  it('removes personal data, counts running battles as given up and keeps results', async () => {
    const running = await activeBattle();
    const open = (await post(anna, '/api/battles', { formatId: BEST_TRICK })).body.battle.id;
    await post(anna, `/api/battles/${running}/messages`, { body: 'hello' });

    const res = await json<{ deletionToken: string }>(
      call('/api/auth/delete-account', {
        session: anna.session,
        body: { password: PASSWORD, keepVideos: true },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.deletionToken.length).toBeGreaterThan(20);

    const battle = (await get(ben, running)).body.battle;
    expect(battle.status).toBe('decided');
    expect(battle.decisionReason).toBe('forfeit');
    expect(battle.participants.find((p) => p.userId === ben.user.id)?.score).toBe(1);
    expect(battle.participants.find((p) => p.userId === anna.user.id)?.displayName).toBe(
      'Deleted user',
    );
    expect((await get(ben, open)).body.battle.cancelReason).toBe('account_deleted');

    const row = await env.DB.prepare(
      'SELECT username, email, password_hash, status FROM users WHERE id = ?',
    )
      .bind(anna.user.id)
      .first<{
        username: string;
        email: string | null;
        password_hash: string | null;
        status: string;
      }>();
    expect(row?.status).toBe('deleted');
    expect(row?.username).not.toBe('anna');
    expect(row?.password_hash).toBeNull();
    const messages = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM battle_messages WHERE sender_id = ?',
    )
      .bind(anna.user.id)
      .first<{ n: number }>();
    expect(messages?.n).toBe(0);
    // Logged out everywhere, the name is free again, the profile is gone.
    expect((await call('/api/auth/me', { session: anna.session })).status).toBe(401);
    expect((await registerAthlete('anna', admin.session)).res.status).toBe(201);
    expect((await call(`/api/users/${anna.user.id}`, { session: ben.session })).status).toBe(404);
  });

  it('deletes the videos right away or later with the deletion link', async () => {
    const id = await activeBattle();
    const video = await uploadAttempt(anna, id);
    const res = await json<{ deletionToken: string }>(
      call('/api/auth/delete-account', {
        session: anna.session,
        body: { password: PASSWORD, keepVideos: true },
      }),
    );
    expect(await videoStatus(video)).toBe('uploaded');
    expect(
      (await call('/api/auth/deletion-request', { body: { token: 'x'.repeat(40) } })).status,
    ).toBe(404);
    const ok = await call('/api/auth/deletion-request', {
      body: { token: res.body.deletionToken },
    });
    expect(ok.status).toBe(200);
    expect(await videoStatus(video)).toBe('deleted');
  });

  it('deletes all videos at once if asked to', async () => {
    const id = await activeBattle();
    const video = await uploadAttempt(ben, id);
    await call('/api/auth/delete-account', {
      session: ben.session,
      body: { password: PASSWORD, keepVideos: false },
    });
    expect(await videoStatus(video)).toBe('deleted');
  });
});

describe('rating replay', () => {
  async function rows(): Promise<ReplayRows> {
    const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
    return {
      battles: await all(REPLAY_QUERIES.battles),
      estimates: await all(REPLAY_QUERIES.estimates),
      rulesets: await all(REPLAY_QUERIES.rulesets),
      formats: await all(REPLAY_QUERIES.formats),
    };
  }

  /** Anna challenges Ben and gives up; Ben counts it as a win. */
  async function benWins() {
    const id = await activeBattle();
    const proposed = await post(anna, `/api/battles/${id}/proposals`, { kind: 'cancel' });
    const proposalId = (proposed.body.battle as unknown as { proposals: { id: string }[] })
      .proposals[0]?.id;
    await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, { decision: 'reject' });
  }

  it('reproduces the ratings the Worker computed battle by battle', async () => {
    await benWins();
    await benWins();
    const before = (
      await env.DB.prepare(
        'SELECT user_id, r, rd, n_battles FROM rating_states ORDER BY user_id',
      ).all()
    ).results;

    const request = await json<{ id: string }>(
      call('/api/rulesets/replay', { session: admin.session, body: { reason: 'test' } }),
    );
    expect(request.status).toBe(201);
    expect(
      (await call('/api/rulesets/replay', { session: ben.session, body: { reason: 'test' } }))
        .status,
    ).toBe(403);

    const result = computeReplay(await rows());
    expect(result.history).toHaveLength(4);
    const statements = replayStatements(result, [request.body.id], Date.now());
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));

    const after = (
      await env.DB.prepare(
        'SELECT user_id, r, rd, n_battles FROM rating_states ORDER BY user_id',
      ).all()
    ).results as { r: number; rd: number }[];
    expect(after).toHaveLength(before.length);
    after.forEach((row, i) => {
      const old = before[i] as { r: number; rd: number };
      expect(row.r).toBeCloseTo(old.r, 6);
      expect(row.rd).toBeCloseTo(old.rd, 6);
    });
    const open = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM replay_requests WHERE done_at IS NULL',
    ).first<{ n: number }>();
    expect(open?.n).toBe(0);
  });
});
