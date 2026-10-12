import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const TRICK_COMBO = '01a12842-5c00-701e-b6c0-4a930af3272a';

type Person = Awaited<ReturnType<typeof registerAthlete>>;

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}
const post = (who: Person, path: string, body?: unknown) =>
  json<{ id?: string; battleId?: string; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

interface Detail {
  competition: { status: string; level: number; confirmedBy: { username: string } | null };
  results: {
    battleId: string;
    formatId: string;
    kind: string;
    status: string;
    cancelReason: string | null;
    participants: { userId: string; score: number | null; placement: number | null }[];
  }[];
  canEdit: boolean;
  canConfirm: boolean;
}
const detail = async (who: Person, id: string) =>
  (await json<Detail>(call(`/api/competitions/${id}`, { session: who.session }))).body;

async function setup() {
  const admin = await registerAdmin();
  const org = await registerAthlete('org', admin.session);
  const judge = await registerAthlete('judge', admin.session);
  const anna = await registerAthlete('anna', admin.session);
  const ben = await registerAthlete('ben', admin.session);
  const carla = await registerAthlete('carla', admin.session);
  for (const [p, role] of [
    [org, 'organizer'],
    [judge, 'judge'],
  ] as const)
    await call(`/api/users/${p.user.id}/roles`, { session: admin.session, body: { role } });
  return { admin, org, judge, anna, ben, carla };
}

async function stateOf(p: Person, formatId: string) {
  return env.DB.prepare(
    'SELECT r, n_battles FROM rating_states WHERE user_id = ? AND format_id = ?',
  )
    .bind(p.user.id, formatId)
    .first<{ r: number; n_battles: number }>();
}

describe('competitions', () => {
  it('results count once a judge confirms; battles beat the final placement', async () => {
    const { org, judge, anna, ben, carla } = await setup();
    expect(
      (await post(anna, '/api/competitions', { name: 'Cup', startsAt: Date.now(), level: 5 }))
        .status,
    ).toBe(403);
    const created = await post(org, '/api/competitions', {
      name: 'Highline Cup',
      location: 'Berlin',
      startsAt: Date.now(),
      level: 5,
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Best Trick: two single battles and a final placement (ignored); 3-Trick Combo: placement only.
    await post(org, `/api/competitions/${id}/battles`, {
      formatId: BEST_TRICK,
      aId: anna.user.id,
      bId: ben.user.id,
      value: 2,
    });
    await post(org, `/api/competitions/${id}/battles`, {
      formatId: BEST_TRICK,
      aId: anna.user.id,
      bId: carla.user.id,
      value: 1,
    });
    await post(org, `/api/competitions/${id}/placements`, {
      formatId: BEST_TRICK,
      placements: [
        { userId: carla.user.id, placement: 1 },
        { userId: anna.user.id, placement: 2 },
        { userId: ben.user.id, placement: 3 },
      ],
    });
    const combo = {
      formatId: TRICK_COMBO,
      placements: [
        { userId: ben.user.id, placement: 1 },
        { userId: carla.user.id, placement: 2 },
        { userId: anna.user.id, placement: 2 },
      ],
    };
    await post(org, `/api/competitions/${id}/placements`, combo);
    // A second placement for the same format replaces the first.
    await post(org, `/api/competitions/${id}/placements`, combo);
    expect((await detail(org, id)).results).toHaveLength(4);

    // Nothing counts yet, and nobody can confirm before the organizer is done.
    expect(await stateOf(anna, BEST_TRICK)).toBeNull();
    expect((await post(judge, `/api/competitions/${id}/confirm`)).status).toBe(409);
    expect((await post(anna, `/api/competitions/${id}/submit`)).status).toBe(403);
    await post(org, `/api/competitions/${id}/submit`);

    const forJudge = await detail(judge, id);
    expect(forJudge).toMatchObject({ canConfirm: true, canEdit: false });
    expect((await detail(anna, id)).canConfirm).toBe(false);
    expect((await post(org, `/api/competitions/${id}/confirm`)).status).toBe(403);
    expect((await post(judge, `/api/competitions/${id}/confirm`)).status).toBe(200);

    const done = await detail(anna, id);
    expect(done.competition).toMatchObject({
      status: 'confirmed',
      confirmedBy: { username: 'judge' },
    });
    const bestTrickPlacement = done.results.find(
      (r) => r.kind === 'placement' && r.formatId === BEST_TRICK,
    );
    expect(bestTrickPlacement).toMatchObject({
      status: 'cancelled',
      cancelReason: 'superseded_by_battles',
    });
    expect(done.results.filter((r) => r.status === 'decided')).toHaveLength(3);

    // Anna won both Best Trick battles at weight 5: two battles, clearly up.
    const annaBest = await stateOf(anna, BEST_TRICK);
    expect(annaBest?.n_battles).toBe(2);
    expect(annaBest?.r).toBeGreaterThan(1600);
    // Ben won the combo placement: one event.
    const benCombo = await stateOf(ben, TRICK_COMBO);
    expect(benCombo?.n_battles).toBe(1);
    expect(benCombo?.r).toBeGreaterThan(1500);
    const level = await env.DB.prepare(
      'SELECT level, level_approved_by FROM battles WHERE competition_id = ? AND status = ? LIMIT 1',
    )
      .bind(id, 'decided')
      .first<{ level: number; level_approved_by: string }>();
    expect(level).toMatchObject({ level: 5, level_approved_by: judge.user.id });

    // Closed now.
    expect(
      (
        await post(org, `/api/competitions/${id}/battles`, {
          formatId: BEST_TRICK,
          aId: ben.user.id,
          bId: carla.user.id,
          value: 1,
        })
      ).status,
    ).toBe(409);
  });

  it('levels 1 and 2 are possible; results can be removed; a cancelled competition never counts', async () => {
    const { org, judge, anna, ben } = await setup();
    const id = (
      await post(org, '/api/competitions', { name: 'Fun jam', startsAt: Date.now(), level: 1 })
    ).body.id as string;
    expect((await detail(org, id)).competition.level).toBe(1);
    const { battleId } = (
      await post(org, `/api/competitions/${id}/battles`, {
        formatId: BEST_TRICK,
        aId: anna.user.id,
        bId: ben.user.id,
        value: -1,
      })
    ).body;
    await post(org, `/api/competitions/${id}/results/${battleId}/remove`);
    expect((await detail(org, id)).results).toHaveLength(0);
    expect((await post(org, `/api/competitions/${id}/submit`)).status).toBe(409);

    await post(org, `/api/competitions/${id}/battles`, {
      formatId: BEST_TRICK,
      aId: anna.user.id,
      bId: ben.user.id,
      value: -1,
    });
    await post(org, `/api/competitions/${id}/cancel`);
    expect((await post(judge, `/api/competitions/${id}/confirm`)).status).toBe(409);
    expect(await stateOf(anna, BEST_TRICK)).toBeNull();
    const list = await json<{ competitions: { id: string; status: string }[] }>(
      call('/api/competitions', { session: anna.session }),
    );
    expect(list.body.competitions.find((x) => x.id === id)?.status).toBe('cancelled');
  });

  it('a judge who took part cannot confirm', async () => {
    const { org, judge, anna } = await setup();
    const id = (
      await post(org, '/api/competitions', { name: 'Cup', startsAt: Date.now(), level: 4 })
    ).body.id as string;
    await post(org, `/api/competitions/${id}/battles`, {
      formatId: BEST_TRICK,
      aId: anna.user.id,
      bId: judge.user.id,
      value: 1,
    });
    await post(org, `/api/competitions/${id}/submit`);
    expect((await detail(judge, id)).canConfirm).toBe(false);
    expect((await post(judge, `/api/competitions/${id}/confirm`)).status).toBe(403);
  });
});
