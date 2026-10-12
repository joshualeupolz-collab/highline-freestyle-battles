import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { poolOutcome, poolWindow } from '../src/battles/review';
import { getDb } from '../src/db/client';
import { resolveExpiredReviews } from '../src/services/review';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Person = Awaited<ReturnType<typeof registerAthlete>>;

interface Review {
  level: number;
  canEscalate: boolean;
  poolCount: number;
  poolVotes: number[] | null;
  myPoolVote: number | null;
  reviewerRole: 'pool' | 'judge' | null;
  votes: { userId: string; value: number }[];
}
interface Battle {
  id: string;
  status: string;
  participants: { userId: string; score: number | null }[];
  review: Review | null;
}

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}
const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );
const get = (who: Person, id: string) =>
  json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: who.session }));

/** A rating state in Best Trick, as if the person had played `n` battles. */
async function setRating(person: Person, r: number, n = 10) {
  await env.DB.prepare(
    `INSERT INTO rating_states (user_id, format_id, r, rd, sigma, last_event_at, n_battles, ruleset_version, computed_at)
     VALUES (?, ?, ?, 80, 0.06, ?, ?, 1, ?)
     ON CONFLICT (user_id, format_id) DO UPDATE SET r = excluded.r, n_battles = excluded.n_battles`,
  )
    .bind(person.user.id, BEST_TRICK, r, Date.now(), n, Date.now())
    .run();
}

/** Anna (seat 0) vs Ben (seat 1) in review; both voted without agreement. */
async function disputedBattle(anna: Person, ben: Person) {
  const created = await post(anna, '/api/battles', { formatId: BEST_TRICK });
  const id = created.body.battle.id;
  await post(ben, `/api/battles/${id}/accept`);
  await env.DB.prepare("UPDATE battles SET status = 'reviewing', played_at = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();
  await post(anna, `/api/battles/${id}/vote`, { value: 1 });
  await post(ben, `/api/battles/${id}/vote`, { value: -1 });
  return id;
}

async function setup() {
  const admin = await registerAdmin();
  const people: Record<string, Person> = { admin };
  for (const name of ['anna', 'ben', 'rev1', 'rev2', 'rev3', 'low', 'high', 'judge'])
    people[name] = await registerAthlete(name, admin.session);
  const p = people as Record<
    'admin' | 'anna' | 'ben' | 'rev1' | 'rev2' | 'rev3' | 'low' | 'high' | 'judge',
    Person
  >;
  await setRating(p.anna, 1500);
  await setRating(p.ben, 1600);
  for (const r of [p.rev1, p.rev2, p.rev3]) await setRating(r, 1650);
  await setRating(p.low, 1400); // below 1600 − 150
  await setRating(p.high, 1900); // above 1600 + 250
  await call(`/api/users/${p.judge.user.id}/roles`, {
    session: admin.session,
    body: { role: 'judge' },
  });
  return p;
}

describe('pool rules', () => {
  it('decides only without contradicting reviews', () => {
    expect(poolOutcome([1, 2], 'scale', 3)).toEqual({ kind: 'open' });
    expect(poolOutcome([1, 2, 0], 'scale', 3)).toEqual({ kind: 'decided', seat0Score: 0.75 });
    expect(poolOutcome([-1, 0, 0], 'scale', 3).kind).toBe('decided');
    expect(poolOutcome([2, 2, -1], 'scale', 3)).toEqual({ kind: 'judges' });
    expect(poolOutcome([0, 0, 0], 'scale', 3)).toEqual({ kind: 'judges' });
    expect(poolOutcome([1, 1, 0], 'win_loss', 3)).toEqual({ kind: 'decided', seat0Score: 1 });
  });

  it('opens the window mainly upwards over time', () => {
    const p = {
      windowBelow: 150,
      windowAbove: 150,
      widenAfterHours: 48,
      widenedAbove: 250,
      openAfterDays: 7,
      openBelow: 250,
    };
    const t0 = 1_000_000;
    expect(poolWindow(1600, t0, t0, p)).toEqual({ min: 1450, max: 1750 });
    expect(poolWindow(1600, t0, t0 + 49 * HOUR, p)).toEqual({ min: 1450, max: 1850 });
    expect(poolWindow(1600, t0, t0 + 8 * DAY, p)).toEqual({ min: 1350, max: null });
  });
});

describe('review levels 2 and 3', () => {
  it('a participant hands the dispute to the pool; three agreeing reviews decide', async () => {
    const p = await setup();
    const id = await disputedBattle(p.anna, p.ben);
    expect((await get(p.anna, id)).body.battle.review?.canEscalate).toBe(true);
    expect((await post(p.rev1, `/api/battles/${id}/escalate`)).status).toBe(403);
    const moved = await post(p.anna, `/api/battles/${id}/escalate`);
    expect(moved.body.battle.review?.level).toBe(2);

    // Who is in the pool: reviewers around R_high = 1600, not too low or too high.
    const open = async (who: Person) =>
      (
        await json<{ reviews: { battleId: string }[] }>(
          call('/api/reviews/open', { session: who.session }),
        )
      ).body.reviews.map((r) => r.battleId);
    expect(await open(p.rev1)).toEqual([id]);
    expect(await open(p.low)).toEqual([]);
    expect(await open(p.high)).toEqual([]);
    expect(await open(p.anna)).toEqual([]);
    expect((await post(p.low, `/api/battles/${id}/pool-vote`, { value: 1 })).status).toBe(403);
    expect((await get(p.rev1, id)).body.battle.review?.reviewerRole).toBe('pool');

    await post(p.rev1, `/api/battles/${id}/pool-vote`, { value: -1 });
    expect((await post(p.rev1, `/api/battles/${id}/pool-vote`, { value: -2 })).status).toBe(409);
    expect(await open(p.rev1)).toEqual([]);
    await post(p.rev2, `/api/battles/${id}/pool-vote`, { value: 0 });
    // Blind: participants see the count, not the values.
    const meanwhile = (await get(p.anna, id)).body.battle.review;
    expect(meanwhile).toMatchObject({ poolCount: 2, poolVotes: null });
    const last = await post(p.rev3, `/api/battles/${id}/pool-vote`, { value: -2 });
    expect(last.body.battle.status).toBe('decided');
    // s(Anna) = mean of 0.25, 0.5, 0 = 0.25.
    expect(last.body.battle.participants.map((x) => x.score)).toEqual([0.25, 0.75]);
  });

  it('contradicting reviews go to the judge, who decides (audited)', async () => {
    const p = await setup();
    const id = await disputedBattle(p.anna, p.ben);
    await post(p.ben, `/api/battles/${id}/escalate`);
    await post(p.rev1, `/api/battles/${id}/pool-vote`, { value: 2 });
    await post(p.rev2, `/api/battles/${id}/pool-vote`, { value: -1 });
    const third = await post(p.rev3, `/api/battles/${id}/pool-vote`, { value: 1 });
    expect(third.body.battle).toMatchObject({ status: 'reviewing', review: { level: 3 } });

    expect((await post(p.rev1, `/api/battles/${id}/judge-decision`, { value: 1 })).status).toBe(
      403,
    );
    const forJudge = (await get(p.judge, id)).body.battle.review;
    expect(forJudge?.reviewerRole).toBe('judge');
    expect(forJudge?.poolVotes?.sort()).toEqual([-1, 1, 2]);
    expect(forJudge?.votes).toHaveLength(2);
    expect((await post(p.judge, `/api/battles/${id}/judge-decision`, { value: 0 })).status).toBe(
      400,
    );
    const decided = await post(p.judge, `/api/battles/${id}/judge-decision`, {
      value: 2,
      note: 'Cleaner landing',
    });
    expect(decided.body.battle.status).toBe('decided');
    expect(decided.body.battle.participants.map((x) => x.score)).toEqual([1, 0]);
    const log = await json<{ entries: { action: string; reason: string }[] }>(
      call('/api/audit?targetType=battle', { session: p.admin.session }),
    );
    expect(log.body.entries[0]).toMatchObject({
      action: 'review.judge_decision',
      reason: 'Cleaner landing',
    });
  });

  it('a pool that does not fill up in time goes to the judges', async () => {
    const p = await setup();
    const id = await disputedBattle(p.anna, p.ben);
    await post(p.anna, `/api/battles/${id}/escalate`);
    await env.DB.prepare('UPDATE battles SET review_level_since = ? WHERE id = ?')
      .bind(Date.now() - 15 * DAY, id)
      .run();
    expect(await resolveExpiredReviews(getDb(env.DB))).toBe(1);
    expect((await get(p.anna, id)).body.battle.review?.level).toBe(3);
    // The window is fully open upwards by then: even the high one could have joined.
  });

  it('pool reviewers may watch "review only" videos while they review', async () => {
    const p = await setup();
    const id = await disputedBattle(p.anna, p.ben);
    const videoId = '01a12842-0000-7000-8000-00000000abcd';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO attempts (id, battle_id, user_id, part_index, round, started_at_client, synced_at)
         VALUES ('att-1', ?, ?, 0, 1, ?, ?)`,
      ).bind(id, p.anna.user.id, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO videos (id, attempt_id, owner_id, battle_id, part_index, round, visibility, retention, quality, status, recorded_at, uploaded_at)
         VALUES (?, 'att-1', ?, ?, 0, 1, 'review_only', 'delete_after_battle', 'normal', 'uploaded', ?, ?)`,
      ).bind(videoId, p.anna.user.id, id, Date.now(), Date.now()),
      env.DB.prepare(
        'INSERT INTO submissions (battle_id, user_id, part_index, round, video_id, submitted_at) VALUES (?, ?, 0, 1, ?, ?)',
      ).bind(id, p.anna.user.id, videoId, Date.now()),
    ]);
    const slot = async (who: Person) =>
      (
        (await get(who, id)).body.battle as Battle & {
          videos: { slots: { userId: string; videoId: string | null }[] };
        }
      ).videos.slots.find((s) => s.userId === p.anna.user.id)?.videoId ?? null;
    expect(await slot(p.rev1)).toBeNull(); // still level 1
    await post(p.anna, `/api/battles/${id}/escalate`);
    expect(await slot(p.rev1)).toBe(videoId);
    expect(await slot(p.low)).toBeNull();
  });
});
