import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}

const estimate = (session: string | null, subjectId: string, value: number, official = false) =>
  call('/api/estimates', {
    session,
    body: { subjectId, formatId: BEST_TRICK, value, official },
  });

/** `winner` beats `loser` (the loser gives up, the winner counts it as a win). */
async function play(winner: { session: string | null }, loser: { session: string | null }) {
  const { battle } = await json<{ battle: { id: string } }>(
    call('/api/battles', { session: loser.session, body: { formatId: BEST_TRICK } }),
  );
  await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: winner.session });
  const proposed = await json<{ battle: { proposals: { id: string }[] } }>(
    call(`/api/battles/${battle.id}/proposals`, {
      session: loser.session,
      body: { kind: 'cancel' },
    }),
  );
  await call(`/api/battles/${battle.id}/proposals/${proposed.battle.proposals[0]?.id}/respond`, {
    session: winner.session,
    body: { decision: 'reject' },
  });
}

async function ratingOf(userId: string) {
  return env.DB.prepare('SELECT r, rd FROM rating_states WHERE user_id = ? AND format_id = ?')
    .bind(userId, BEST_TRICK)
    .first<{ r: number; rd: number }>();
}

async function openReplays() {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM replay_requests WHERE done_at IS NULL',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('initial estimates', () => {
  it('the median of three athletes becomes the starting value at the first battle', async () => {
    const admin = await registerAdmin();
    const dora = await registerAthlete('dora', admin.session);
    const a = await registerAthlete('abe', admin.session);
    const b = await registerAthlete('bea', admin.session);
    const c = await registerAthlete('cid', admin.session);
    const opponent = await registerAthlete('opp', admin.session);
    expect((await estimate(a.session, dora.user.id, 1700)).status).toBe(201);
    expect((await estimate(b.session, dora.user.id, 1800)).status).toBe(201);
    // c changes their mind: only the latest counts.
    await estimate(c.session, dora.user.id, 2500);
    await estimate(c.session, dora.user.id, 1900);
    expect(await openReplays()).toBe(0);

    const seen = await json<{ mine: { value: number }[]; count: number; all: unknown }>(
      call(`/api/estimates?subjectId=${dora.user.id}`, { session: c.session }),
    );
    expect(seen).toMatchObject({ mine: [{ value: 1900 }], count: 3, all: null });
    const forDora = await json<{ mine: unknown[]; count: number; all: unknown }>(
      call(`/api/estimates?subjectId=${dora.user.id}`, { session: dora.session }),
    );
    expect(forDora).toEqual({ mine: [], count: 3, all: null });
    const forAdmin = await json<{ all: { estimator: { username: string } }[] }>(
      call(`/api/estimates?subjectId=${dora.user.id}`, { session: admin.session }),
    );
    expect(forAdmin.all.map((e) => e.estimator.username).sort()).toEqual(['abe', 'bea', 'cid']);

    // Dora loses her first battle: she started at the median 1800 with RD 200.
    await play(opponent, dora);
    const state = await ratingOf(dora.user.id);
    expect(state?.r).toBeLessThan(1800);
    expect(state?.r).toBeGreaterThan(1600); // from 1500 it would end below 1500
    expect(state?.rd).toBeLessThan(200);
  });

  it('an official estimate overrides; a late estimate requests a replay; limits apply', async () => {
    const admin = await registerAdmin();
    const dora = await registerAthlete('dora', admin.session);
    const anna = await registerAthlete('anna', admin.session);

    expect((await estimate(dora.session, dora.user.id, 1600)).status).toBe(400);
    expect((await estimate(anna.session, dora.user.id, 1600, true)).status).toBe(403);
    expect((await estimate(anna.session, dora.user.id, 100)).status).toBe(400);
    expect((await estimate(admin.session, dora.user.id, 2000, true)).status).toBe(201);

    await play(anna, dora);
    expect((await ratingOf(dora.user.id))?.r).toBeGreaterThan(1800);

    // After the first battle an estimate still counts, but needs a replay.
    const late = await json<{ replay: boolean }>(estimate(anna.session, dora.user.id, 1600));
    expect(late.replay).toBe(true);
    expect(await openReplays()).toBe(1);

    // From MIN_BATTLES (5) battles on, no more estimates.
    for (let i = 0; i < 4; i++) await play(anna, dora);
    expect((await estimate(admin.session, dora.user.id, 1600)).status).toBe(409);
  });

  it('withdrawing my estimate', async () => {
    const admin = await registerAdmin();
    const dora = await registerAthlete('dora', admin.session);
    const anna = await registerAthlete('anna', admin.session);
    const { id } = await json<{ id: string }>(estimate(anna.session, dora.user.id, 1700));
    expect(
      (await call(`/api/estimates/${id}/withdraw`, { method: 'POST', session: dora.session }))
        .status,
    ).toBe(404);
    await call(`/api/estimates/${id}/withdraw`, { method: 'POST', session: anna.session });
    const seen = await json<{ count: number }>(
      call(`/api/estimates?subjectId=${dora.user.id}`, { session: anna.session }),
    );
    expect(seen.count).toBe(0);
  });
});
