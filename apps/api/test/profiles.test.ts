import { describe, expect, it } from 'vitest';
import { call, register, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}

/** Anna challenges Ben, Ben accepts, Anna gives up, Ben counts it as a win. */
async function benBeatsAnna() {
  const admin = await registerAdmin();
  const anna = await registerAthlete('anna', admin.session);
  const ben = await registerAthlete('ben', admin.session);
  const { battle } = await json<{ battle: { id: string } }>(
    call('/api/battles', { session: anna.session, body: { formatId: BEST_TRICK } }),
  );
  await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: ben.session });
  const proposed = await json<{ battle: { proposals: { id: string }[] } }>(
    call(`/api/battles/${battle.id}/proposals`, {
      session: anna.session,
      body: { kind: 'cancel' },
    }),
  );
  const proposalId = proposed.battle.proposals[0]?.id;
  await call(`/api/battles/${battle.id}/proposals/${proposalId}/respond`, {
    session: ben.session,
    body: { decision: 'reject' },
  });
  return { admin, anna, ben, battleId: battle.id };
}

describe('profiles', () => {
  it('shows ratings per format, the approver and recent battles with the rating change', async () => {
    const { admin, anna, ben } = await benBeatsAnna();
    const profile = await json<{
      user: { username: string; approvedBy: { username: string } | null; roles: string[] };
      ratings: {
        formatName: string;
        r: number;
        rd: number;
        provisional: boolean;
        nBattles: number;
      }[];
      battles: {
        status: string;
        score: number;
        ratingChange: number;
        opponents: { username: string }[];
      }[];
    }>(call(`/api/users/${ben.user.id}`, { session: anna.session }));

    expect(profile.user).toMatchObject({
      username: 'ben',
      approvedBy: { username: 'admin' },
      roles: ['athlete'],
    });
    expect(profile.ratings).toHaveLength(1);
    expect(profile.ratings[0]).toMatchObject({
      formatName: 'Best Trick',
      nBattles: 1,
      provisional: true,
    });
    expect(profile.ratings[0]?.r).toBeGreaterThan(1500);
    expect(profile.battles[0]).toMatchObject({
      status: 'decided',
      score: 1,
      opponents: [{ username: 'anna' }],
    });
    expect(profile.battles[0]?.ratingChange).toBeGreaterThan(0);
    expect((await call(`/api/users/${admin.user.id}`, { session: anna.session })).status).toBe(200);
  });

  it('is only visible to approved, logged-in users', async () => {
    const { ben } = await benBeatsAnna();
    expect((await call(`/api/users/${ben.user.id}`)).status).toBe(401);
    const pending = await register('dora');
    expect((await call(`/api/users/${ben.user.id}`, { session: pending.session })).status).toBe(
      403,
    );
    expect((await call('/api/users/unknown', { session: ben.session })).status).toBe(404);
  });
});

describe('format ranking', () => {
  it('ranks by r − 2·RD and includes the ratings in the battle', async () => {
    const { anna, ben, battleId } = await benBeatsAnna();
    const res = await json<{ ranking: { rank: number; username: string; provisional: boolean }[] }>(
      call(`/api/formats/${BEST_TRICK}/ranking`, { session: anna.session }),
    );
    expect(res.ranking.map((e) => [e.rank, e.username])).toEqual([
      [1, 'ben'],
      [2, 'anna'],
    ]);
    expect(res.ranking.every((e) => e.provisional)).toBe(true);

    const battle = await json<{ battle: { participants: { rating: { r: number } | null }[] } }>(
      call(`/api/battles/${battleId}`, { session: ben.session }),
    );
    expect(battle.battle.participants.every((p) => p.rating !== null)).toBe(true);
    expect((await call(`/api/formats/${BEST_TRICK}/ranking`)).status).toBe(401);
  });
});
