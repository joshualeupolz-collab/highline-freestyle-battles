import { env } from 'cloudflare:workers';
import { ONSITE_CONFIRM_DAYS } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { resolveAbandonedDeadlines } from '../src/services/battles';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const DAY = 86_400_000;

interface Battle {
  id: string;
  mode: string;
  status: string;
  playedAt: number | null;
  decisionReason: string | null;
  cancelReason: string | null;
  participants: { userId: string; seat: number; score: number | null }[];
  proposals: { id: string; kind: string; proposedBy: string; payload: { value?: number } }[];
  ratingChanges: { userId: string; before: number; after: number }[];
}

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let anna: Person;
let ben: Person;
let carla: Person;

beforeEach(async () => {
  const admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
  carla = await registerAthlete('carla', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

/** Anna enters an on-site battle against Ben. */
function enter(body: Record<string, unknown> = {}) {
  return post(anna, '/api/battles/onsite', {
    formatId: BEST_TRICK,
    opponentId: ben.user.id,
    playedAt: Date.now() - DAY,
    value: 1,
    ...body,
  });
}

const respond = (who: Person, battle: Battle, decision: 'accept' | 'reject', index = 0) =>
  post(who, `/api/battles/${battle.id}/proposals/${battle.proposals[index]?.id}/respond`, {
    decision,
  });

describe('on-site results', () => {
  it('counts once the opponent confirms, and updates the ratings', async () => {
    const created = await enter({ value: 2 });
    expect(created.status).toBe(201);
    const battle = created.body.battle;
    expect(battle.mode).toBe('onsite');
    expect(battle.status).toBe('negotiating');
    expect(battle.proposals.map((p) => p.kind)).toEqual(['result']);

    // Anna cannot confirm her own result; outsiders cannot either.
    expect((await respond(anna, battle, 'accept')).status).toBe(400);
    expect((await respond(carla, battle, 'accept')).status).toBe(403);

    const confirmed = await respond(ben, battle, 'accept');
    expect(confirmed.body.battle.status).toBe('decided');
    expect(confirmed.body.battle.decisionReason).toBe('onsite');
    expect(confirmed.body.battle.participants.map((p) => p.score)).toEqual([1, 0]);
    expect(confirmed.body.battle.ratingChanges).toHaveLength(2);
  });

  it('lets the opponent reject and enter a different result', async () => {
    const battle = (await enter({ value: 1 })).body.battle;
    const rejected = await respond(ben, battle, 'reject');
    expect(rejected.body.battle.status).toBe('negotiating');
    expect(rejected.body.battle.proposals).toEqual([]);

    // Ben sees it the other way round: Ben somewhat better (from his view, +1).
    const counter = await post(ben, `/api/battles/${battle.id}/proposals`, {
      kind: 'result',
      value: 1,
    });
    expect(counter.status).toBe(201);
    const accepted = await respond(anna, counter.body.battle, 'accept');
    expect(accepted.body.battle.status).toBe('decided');
    // Seat 0 (Anna) lost "somewhat": 0.25.
    expect(accepted.body.battle.participants.map((p) => p.score)).toEqual([0.25, 0.75]);
  });

  it('uses 1 / 0 for win/loss', async () => {
    const battle = (await enter({ value: -1, scoring: 'win_loss' })).body.battle;
    const res = await respond(ben, battle, 'accept');
    expect(res.body.battle.participants.map((p) => p.score)).toEqual([0, 1]);
  });

  it('can be withdrawn by either side and expires unconfirmed', async () => {
    const withdrawn = (await enter()).body.battle;
    const res = await post(ben, `/api/battles/${withdrawn.id}/withdraw-onsite`);
    expect(res.body.battle.status).toBe('cancelled');
    expect(res.body.battle.cancelReason).toBe('onsite_withdrawn');

    const forgotten = (await enter()).body.battle;
    await resolveAbandonedDeadlines(getDb(env.DB), Date.now() + (ONSITE_CONFIRM_DAYS + 1) * DAY);
    const after = await json<{ battle: Battle }>(
      call(`/api/battles/${forgotten.id}`, { session: anna.session }),
    );
    expect(after.body.battle.status).toBe('cancelled');
    expect(after.body.battle.cancelReason).toBe('expired');
  });

  it('checks the input', async () => {
    expect((await enter({ value: 0 })).status).toBe(400);
    expect((await enter({ opponentId: anna.user.id })).body.error).toBe(
      'cannot_challenge_yourself',
    );
    expect((await enter({ level: 4 })).body.error).toBe('level_requires_approval');
    expect((await enter({ playedAt: Date.now() + DAY })).body.error).toBe('played_in_future');
    expect((await enter({ playedAt: Date.now() - 90 * DAY })).body.error).toBe(
      'played_too_long_ago',
    );
  });

  it('keeps online and on-site proposals apart', async () => {
    const onsite = (await enter()).body.battle;
    const settings = await post(anna, `/api/battles/${onsite.id}/proposals`, {
      kind: 'cancel',
    });
    expect(settings.body.error).toBe('unsupported_proposal');
    expect((await post(ben, `/api/battles/${onsite.id}/start`)).status).toBe(409);

    const online = await post(anna, '/api/battles', { formatId: BEST_TRICK });
    await post(ben, `/api/battles/${online.body.battle.id}/accept`);
    const result = await post(anna, `/api/battles/${online.body.battle.id}/proposals`, {
      kind: 'result',
      value: 2,
    });
    expect(result.body.error).toBe('unsupported_proposal');
  });
});
