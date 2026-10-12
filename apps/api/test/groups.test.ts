import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { computeReplay, REPLAY_QUERIES, type ReplayRows } from '../src/services/replay';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

type Person = Awaited<ReturnType<typeof registerAthlete>>;
interface Battle {
  id: string;
  kind: string;
  status: string;
  participants: { userId: string; seat: number; placement: number | null }[];
  proposals: { id: string; acceptedBy: string[]; payload: { placements?: unknown[] } }[];
  ratingChanges: { userId: string; before: number; after: number }[];
}

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}
const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

async function setup() {
  const admin = await registerAdmin();
  const anna = await registerAthlete('anna', admin.session);
  const ben = await registerAthlete('ben', admin.session);
  const carla = await registerAthlete('carla', admin.session);
  const dora = await registerAthlete('dora', admin.session);
  return { admin, anna, ben, carla, dora };
}

const placements = (list: [Person, number][]) =>
  list.map(([p, placement]) => ({ userId: p.user.id, placement }));

describe('on-site group battles', () => {
  it('counts once everyone confirmed; rated as one event with all pairs', async () => {
    const { anna, ben, carla, dora } = await setup();
    const created = await post(anna, '/api/battles/onsite-group', {
      formatId: BEST_TRICK,
      playedAt: Date.now(),
      placements: placements([
        [ben, 1],
        [anna, 2],
        [carla, 2],
        [dora, 4],
      ]),
    });
    expect(created.status).toBe(201);
    const id = created.body.battle.id;
    expect(created.body.battle).toMatchObject({ kind: 'group', status: 'negotiating' });
    expect(created.body.battle.participants.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(created.body.battle.proposals[0]?.acceptedBy).toEqual([anna.user.id]);

    expect((await post(ben, `/api/battles/${id}/group-confirm`)).body.battle.status).toBe(
      'negotiating',
    );
    await post(carla, `/api/battles/${id}/group-confirm`);
    const last = await post(dora, `/api/battles/${id}/group-confirm`);
    expect(last.body.battle.status).toBe('decided');
    const placementOf = (p: Person) =>
      last.body.battle.participants.find((x) => x.userId === p.user.id)?.placement;
    expect([anna, ben, carla, dora].map(placementOf)).toEqual([2, 1, 2, 4]);

    const change = (p: Person) => {
      const r = last.body.battle.ratingChanges.find((x) => x.userId === p.user.id);
      return (r?.after ?? 0) - (r?.before ?? 0);
    };
    expect(last.body.battle.ratingChanges).toHaveLength(4);
    expect(change(ben)).toBeGreaterThan(0);
    expect(change(dora)).toBeLessThan(0);
    // Equal places from equal ratings: the same change.
    expect(change(anna)).toBeCloseTo(change(carla), 6);

    // A group battle counts as one battle for each person (rating spec §8.1).
    const state = await env.DB.prepare(
      'SELECT n_battles FROM rating_states WHERE user_id = ? AND format_id = ?',
    )
      .bind(ben.user.id, BEST_TRICK)
      .first<{ n_battles: number }>();
    expect(state?.n_battles).toBe(1);

    // The replay reproduces it from the stored placements.
    const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
    const rows: ReplayRows = {
      battles: await all(REPLAY_QUERIES.battles),
      estimates: await all(REPLAY_QUERIES.estimates),
      rulesets: await all(REPLAY_QUERIES.rulesets),
      formats: await all(REPLAY_QUERIES.formats),
    };
    const replayed = computeReplay(rows);
    expect(replayed.history).toHaveLength(4);
    const benAfter = replayed.history.find((h) => h.personId === ben.user.id)?.rAfter;
    expect(benAfter).toBeCloseTo(
      last.body.battle.ratingChanges.find((x) => x.userId === ben.user.id)?.after ?? 0,
      6,
    );
  });

  it('a rejected result can be corrected and then confirmed', async () => {
    const { anna, ben, carla } = await setup();
    const { body } = await post(anna, '/api/battles/onsite-group', {
      formatId: BEST_TRICK,
      playedAt: Date.now(),
      placements: placements([
        [anna, 1],
        [ben, 2],
        [carla, 3],
      ]),
    });
    const id = body.battle.id;
    const rejected = await post(ben, `/api/battles/${id}/group-reject`);
    expect(rejected.body.battle.proposals).toHaveLength(0);
    expect((await post(carla, `/api/battles/${id}/group-confirm`)).status).toBe(409);

    // Ben enters his version; Ben has agreed by entering it.
    const fixed = await post(ben, `/api/battles/${id}/group-result`, {
      placements: placements([
        [ben, 1],
        [anna, 2],
        [carla, 3],
      ]),
    });
    expect(fixed.body.battle.proposals[0]?.acceptedBy).toEqual([ben.user.id]);
    await post(anna, `/api/battles/${id}/group-confirm`);
    const done = await post(carla, `/api/battles/${id}/group-confirm`);
    expect(done.body.battle.status).toBe('decided');
  });

  it('one official who does not take part confirms for everyone (audited)', async () => {
    const { admin, anna, ben, carla, dora } = await setup();
    await call(`/api/users/${dora.user.id}/roles`, {
      session: admin.session,
      body: { role: 'organizer' },
    });
    await call(`/api/users/${anna.user.id}/roles`, {
      session: admin.session,
      body: { role: 'judge' },
    });
    const { body } = await post(ben, '/api/battles/onsite-group', {
      formatId: BEST_TRICK,
      playedAt: Date.now(),
      placements: placements([
        [anna, 3],
        [ben, 1],
        [carla, 2],
      ]),
    });
    const id = body.battle.id;
    // Anna is a judge but takes part; a plain athlete cannot confirm for others.
    expect((await post(anna, `/api/battles/${id}/official-confirm`)).status).toBe(403);
    expect((await post(admin, `/api/battles/${id}/official-confirm`)).status).toBe(403);
    const confirmed = await post(dora, `/api/battles/${id}/official-confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.battle.status).toBe('decided');
    const log = await json<{ entries: { action: string; targetId: string }[] }>(
      call('/api/audit?targetType=battle', { session: admin.session }),
    );
    expect(log.body.entries[0]).toMatchObject({ action: 'battle.official_confirm', targetId: id });
  });

  it('checks the placements and keeps the single-battle proposals out', async () => {
    const { anna, ben, carla } = await setup();
    const create = (list: { userId: string; placement: number }[]) =>
      post(anna, '/api/battles/onsite-group', {
        formatId: BEST_TRICK,
        playedAt: Date.now(),
        placements: list,
      });
    expect(
      (
        await create(
          placements([
            [ben, 1],
            [carla, 2],
          ]),
        )
      ).status,
    ).toBe(400); // too few
    expect(
      (
        await create(
          placements([
            [ben, 1],
            [carla, 2],
            [carla, 3],
          ]),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await create(
          placements([
            [anna, 1],
            [ben, 1],
            [carla, 1],
          ]),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await create(
          placements([
            [anna, 1],
            [ben, 2],
            [carla, 4],
          ]),
        )
      ).status,
    ).toBe(400);
    const outsider = await create(
      placements([
        [ben, 1],
        [carla, 2],
        [ben, 3],
      ]),
    );
    expect(outsider.status).toBe(400);
    const ok = await create(
      placements([
        [anna, 1],
        [ben, 2],
        [carla, 3],
      ]),
    );
    const id = ok.body.battle.id;
    expect(
      (await post(ben, `/api/battles/${id}/proposals`, { kind: 'result', value: 2 })).status,
    ).toBe(400);
    const proposalId = ok.body.battle.proposals[0]?.id;
    expect(
      (
        await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
          decision: 'accept',
        })
      ).status,
    ).toBe(400);
    // Withdrawing works as for on-site single battles.
    expect((await post(carla, `/api/battles/${id}/withdraw-onsite`)).body.battle.status).toBe(
      'cancelled',
    );
  });
});
