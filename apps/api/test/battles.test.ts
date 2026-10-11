import { env } from 'cloudflare:workers';
import { defaultDeadline } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { resolveAbandonedDeadlines } from '../src/services/battles';
import { call, register, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const HOUR = 3_600_000;

interface Battle {
  id: string;
  status: string;
  settings: {
    attemptsPerVideo: number | null;
    deadlineAt: number | null;
    level: number;
    scoring: string;
  };
  deadlineAt: number | null;
  deadlinePassed: boolean;
  decisionReason: string | null;
  cancelReason: string | null;
  participants: { userId: string; seat: number; extraAttempts: number; score: number | null }[];
  proposals: { id: string; kind: string; acceptedBy: string[] }[];
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

async function createBattle(who: Person, body: Record<string, unknown> = {}) {
  const res = await json<{ battle: Battle }>(
    call('/api/battles', { session: who.session, body: { formatId: BEST_TRICK, ...body } }),
  );
  expect(res.status).toBe(201);
  return res.body.battle;
}

const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

async function activeBattle() {
  const battle = await createBattle(anna);
  await post(ben, `/api/battles/${battle.id}/accept`);
  return battle.id;
}

async function propose(who: Person, battleId: string, body: unknown) {
  const res = await post(who, `/api/battles/${battleId}/proposals`, body);
  expect(res.status).toBe(201);
  return res.body.battle.proposals.at(-1)?.id as string;
}

/** Simulates a submitted video (the real flow is tested in videos.test.ts). */
async function deliver(battleId: string, userId: string) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO attempts (id, battle_id, user_id, part_index, started_at_client, synced_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(`a-${userId}`, battleId, userId, now, now),
    env.DB.prepare(
      'INSERT INTO videos (id, attempt_id, owner_id, battle_id, part_index, recorded_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind(`v-${userId}`, `a-${userId}`, userId, battleId, now),
    env.DB.prepare(
      'INSERT INTO submissions (battle_id, user_id, part_index, video_id, submitted_at) VALUES (?, ?, 0, ?, ?)',
    ).bind(battleId, userId, `v-${userId}`, now),
  ]);
}

async function expireDeadline(battleId: string) {
  await env.DB.prepare('UPDATE battles SET deadline_at = ? WHERE id = ?')
    .bind(Date.now() - 1, battleId)
    .run();
}

async function ratings() {
  const { results } = await env.DB.prepare('SELECT user_id, r, n_battles FROM rating_states').all<{
    user_id: string;
    r: number;
    n_battles: number;
  }>();
  return Object.fromEntries(results.map((s) => [s.user_id, s]));
}

describe('requests', () => {
  it('creates an open request with the default settings', async () => {
    const battle = await createBattle(anna);
    expect(battle).toMatchObject({
      status: 'open',
      settings: { attemptsPerVideo: 3, level: 3, scoring: 'scale' },
    });
    // Default deadline: in 7 days at 05:00 German time.
    expect(battle.settings.deadlineAt).toBe(defaultDeadline());
    expect(battle.deadlineAt).toBe(battle.settings.deadlineAt);
    expect(battle.participants.map((p) => p.userId)).toEqual([anna.user.id]);
  });

  it('accepts any number of attempts and any deadline within the limits', async () => {
    const deadlineAt = Date.now() + 30 * HOUR;
    const battle = await createBattle(anna, { settings: { attemptsPerVideo: 7, deadlineAt } });
    expect(battle.settings).toMatchObject({ attemptsPerVideo: 7, deadlineAt });
    for (const bad of [Date.now() - HOUR, Date.now() + 61 * 24 * HOUR]) {
      const res = await call('/api/battles', {
        session: anna.session,
        body: { formatId: BEST_TRICK, settings: { deadlineAt: bad } },
      });
      expect(res.status).toBe(400);
    }
    const tooMany = await call('/api/battles', {
      session: anna.session,
      body: { formatId: BEST_TRICK, settings: { attemptsPerVideo: 100 } },
    });
    expect(tooMany.status).toBe(400);
  });

  it('rejects weight 4–5, unknown formats and accounts that are not approved', async () => {
    const res = await call('/api/battles', {
      session: anna.session,
      body: { formatId: BEST_TRICK, settings: { level: 4 } },
    });
    expect(res.status).toBe(400);
    expect(
      (await call('/api/battles', { session: anna.session, body: { formatId: 'nope' } })).status,
    ).toBe(400);
    const pending = await register('dora');
    expect(
      (await call('/api/battles', { session: pending.session, body: { formatId: BEST_TRICK } }))
        .status,
    ).toBe(403);
  });

  it('lists open requests of others, closest rating first, direct challenges on top', async () => {
    const now = Date.now();
    const rate = (userId: string, r: number) =>
      env.DB.prepare(
        'INSERT INTO rating_states (format_id, user_id, r, rd, sigma, n_battles, ruleset_version, computed_at) VALUES (?, ?, ?, 80, 0.06, 10, 1, ?)',
      )
        .bind(BEST_TRICK, userId, r, now)
        .run();
    await rate(anna.user.id, 1600);
    await rate(ben.user.id, 1900);
    await rate(admin.user.id, 1550);
    await createBattle(ben);
    await createBattle(admin);
    await createBattle(carla, { invitedUserId: ben.user.id }); // not visible to anna
    await createBattle(anna); // own request: not listed

    const { body } = await json<{ requests: { challenger: { username: string } }[] }>(
      call('/api/battles/open', { session: anna.session }),
    );
    expect(body.requests.map((r) => r.challenger.username)).toEqual(['admin', 'ben']);

    const forBen = await json<{
      requests: { challenger: { username: string }; direct: boolean }[];
    }>(call('/api/battles/open', { session: ben.session }));
    expect(forBen.body.requests[0]).toMatchObject({
      direct: true,
      challenger: { username: 'carla' },
    });
  });

  it('hides requests whose deadline has passed and refuses to accept them', async () => {
    const battle = await createBattle(ben);
    await env.DB.prepare('UPDATE battles SET deadline_at = ? WHERE id = ?')
      .bind(Date.now() - 1, battle.id)
      .run();
    const { body } = await json<{ requests: unknown[] }>(
      call('/api/battles/open', { session: anna.session }),
    );
    expect(body.requests).toEqual([]);
    expect((await post(anna, `/api/battles/${battle.id}/accept`)).status).toBe(409);
    await resolveAbandonedDeadlines(getDb(env.DB));
    const after = await json<{ battle: Battle }>(
      call(`/api/battles/${battle.id}`, { session: ben.session }),
    );
    expect(after.body.battle).toMatchObject({ status: 'cancelled', cancelReason: 'expired' });
  });

  it('lets the challenger retract an open request', async () => {
    const battle = await createBattle(anna);
    expect((await post(ben, `/api/battles/${battle.id}/retract`)).status).toBe(403);
    const res = await post(anna, `/api/battles/${battle.id}/retract`);
    expect(res.body.battle).toMatchObject({ status: 'cancelled', cancelReason: 'retracted' });
  });
});

describe('acceptance', () => {
  it('starts the battle at once and keeps the fixed deadline', async () => {
    const deadlineAt = Date.now() + 50 * HOUR;
    const battle = await createBattle(anna, { settings: { deadlineAt } });
    const res = await post(ben, `/api/battles/${battle.id}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.battle.status).toBe('active');
    expect(res.body.battle.deadlineAt).toBe(deadlineAt);
    expect((await post(carla, `/api/battles/${battle.id}/accept`)).status).toBe(409);
  });

  it('does not let people accept their own request or a challenge meant for someone else', async () => {
    const own = await createBattle(anna);
    expect((await post(anna, `/api/battles/${own.id}/accept`)).status).toBe(400);
    const direct = await createBattle(anna, { invitedUserId: ben.user.id });
    expect((await post(carla, `/api/battles/${direct.id}/accept`)).status).toBe(403);
    expect((await post(ben, `/api/battles/${direct.id}/accept`)).status).toBe(200);
  });

  it('negotiates flexible settings: the accepting side can start with them as they are', async () => {
    const battle = await createBattle(anna, {
      settingsFlexible: true,
      settings: { deadlineAt: null },
    });
    expect((await post(ben, `/api/battles/${battle.id}/accept`)).body.battle.status).toBe(
      'negotiating',
    );
    expect((await post(anna, `/api/battles/${battle.id}/start`)).status).toBe(403);
    const res = await post(ben, `/api/battles/${battle.id}/start`);
    expect(res.body.battle).toMatchObject({ status: 'active', deadlineAt: null });
  });

  it('negotiates flexible settings: an accepted counter-proposal applies and starts the battle', async () => {
    const battle = await createBattle(anna, { settingsFlexible: true });
    await post(ben, `/api/battles/${battle.id}/accept`);
    const counterDeadline = Date.now() + 48 * HOUR;
    const proposalId = await propose(ben, battle.id, {
      kind: 'settings',
      changes: { attemptsPerVideo: 1, deadlineAt: counterDeadline },
    });
    const res = await post(anna, `/api/battles/${battle.id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(res.body.battle).toMatchObject({
      status: 'active',
      settings: { attemptsPerVideo: 1, deadlineAt: counterDeadline },
      deadlineAt: counterDeadline,
    });
  });
});

describe('change proposals during the battle', () => {
  it('applies a settings change only after the other side accepts', async () => {
    const id = await activeBattle();
    const proposalId = await propose(anna, id, { kind: 'settings', changes: { level: 1 } });
    expect(
      (
        await post(anna, `/api/battles/${id}/proposals/${proposalId}/respond`, {
          decision: 'accept',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(carla, `/api/battles/${id}/proposals/${proposalId}/respond`, {
          decision: 'accept',
        })
      ).status,
    ).toBe(403);
    const res = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(res.body.battle.settings.level).toBe(1);
    expect(res.body.battle.proposals).toEqual([]);
  });

  it('keeps everything as it is when the proposal is rejected or withdrawn', async () => {
    const id = await activeBattle();
    const first = await propose(anna, id, { kind: 'settings', changes: { scoring: 'win_loss' } });
    const res = await post(ben, `/api/battles/${id}/proposals/${first}/respond`, {
      decision: 'reject',
    });
    expect(res.body.battle.settings.scoring).toBe('scale');
    const second = await propose(anna, id, { kind: 'settings', changes: { scoring: 'win_loss' } });
    await post(anna, `/api/battles/${id}/proposals/${second}/withdraw`);
    expect(
      (await post(ben, `/api/battles/${id}/proposals/${second}/respond`, { decision: 'accept' }))
        .status,
    ).toBe(409);
  });

  it('moves the deadline by an accepted extension or settings change', async () => {
    const id = await activeBattle();
    const past = { kind: 'settings', changes: { deadlineAt: Date.now() - HOUR } };
    expect((await post(anna, `/api/battles/${id}/proposals`, past)).status).toBe(400);
    const earlier = Date.now() + 10 * HOUR;
    const changeId = await propose(anna, id, {
      kind: 'settings',
      changes: { deadlineAt: earlier },
    });
    const changed = await post(ben, `/api/battles/${id}/proposals/${changeId}/respond`, {
      decision: 'accept',
    });
    expect(changed.body.battle.deadlineAt).toBe(earlier);
    const deadlineAt = Date.now() + 500 * HOUR;
    const proposalId = await propose(anna, id, { kind: 'extension', deadlineAt });
    const res = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(res.body.battle.deadlineAt).toBe(deadlineAt);
  });

  it('gives the opponent an extra attempt as goodwill', async () => {
    const id = await activeBattle();
    const res = await post(anna, `/api/battles/${id}/grant-attempt`);
    expect(res.body.battle.participants.map((p) => p.extraAttempts)).toEqual([0, 1]);
  });

  it('takes back an extra attempt only if the receiving side agrees', async () => {
    const id = await activeBattle();
    const takeBack = { kind: 'extra_attempt', change: -1 };
    expect((await post(anna, `/api/battles/${id}/proposals`, takeBack)).status).toBe(409);
    await post(anna, `/api/battles/${id}/grant-attempt`);
    const proposalId = await propose(anna, id, takeBack);
    const res = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(res.body.battle.participants.map((p) => p.extraAttempts)).toEqual([0, 0]);
  });
});

describe('cancellation', () => {
  it('cancels unrated when the other side agrees', async () => {
    const id = await activeBattle();
    const proposalId = await propose(anna, id, { kind: 'cancel' });
    const res = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'accept',
    });
    expect(res.body.battle).toMatchObject({ status: 'cancelled', cancelReason: 'agreed' });
    expect(await ratings()).toEqual({});
  });

  it('counts as a win for the other side if they say so, and updates the ratings', async () => {
    const id = await activeBattle();
    const proposalId = await propose(anna, id, { kind: 'cancel' });
    const res = await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, {
      decision: 'reject',
    });
    expect(res.body.battle).toMatchObject({ status: 'decided', decisionReason: 'forfeit' });
    expect(res.body.battle.participants.map((p) => p.score)).toEqual([0, 1]);

    const r = await ratings();
    expect(r[ben.user.id]?.r).toBeGreaterThan(1500);
    expect(r[anna.user.id]?.r).toBeLessThan(1500);
    expect(r[ben.user.id]?.n_battles).toBe(1);
    const history = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM rating_history WHERE battle_id = ?',
    )
      .bind(id)
      .first<{ n: number }>();
    expect(history?.n).toBe(2);
  });
});

describe('missed deadline', () => {
  it('can only be cancelled when nobody delivered', async () => {
    const id = await activeBattle();
    expect(
      (await post(anna, `/api/battles/${id}/deadline-decision`, { choice: 'cancel' })).status,
    ).toBe(409);
    await expireDeadline(id);
    expect(
      (await post(anna, `/api/battles/${id}/deadline-decision`, { choice: 'claim_win' })).status,
    ).toBe(409);
    const res = await post(anna, `/api/battles/${id}/deadline-decision`, { choice: 'cancel' });
    expect(res.body.battle).toMatchObject({ status: 'cancelled', cancelReason: 'deadline_missed' });
  });

  it('lets the side that delivered claim the win', async () => {
    const id = await activeBattle();
    await deliver(id, anna.user.id);
    await expireDeadline(id);
    const detail = await json<{ battle: Battle }>(
      call(`/api/battles/${id}`, { session: ben.session }),
    );
    expect(detail.body.battle.deadlinePassed).toBe(true);

    expect(
      (await post(ben, `/api/battles/${id}/deadline-decision`, { choice: 'cancel' })).status,
    ).toBe(403);
    const res = await post(anna, `/api/battles/${id}/deadline-decision`, { choice: 'claim_win' });
    expect(res.body.battle).toMatchObject({ status: 'decided', decisionReason: 'deadline' });
    expect((await ratings())[anna.user.id]?.r).toBeGreaterThan(1500);
  });
});

describe('abandoned deadline (scheduled job)', () => {
  const DAY = 24 * HOUR;
  const setDeadline = (battleId: string, at: number) =>
    env.DB.prepare('UPDATE battles SET deadline_at = ? WHERE id = ?').bind(at, battleId).run();
  const status = async (battleId: string) =>
    (await json<{ battle: Battle }>(call(`/api/battles/${battleId}`, { session: anna.session })))
      .body.battle;

  it('decides for the delivering side after 7 days, cancels when nobody delivered', async () => {
    const delivered = await activeBattle();
    await deliver(delivered, ben.user.id);
    await setDeadline(delivered, Date.now() - 8 * DAY);
    const nobody = await activeBattle();
    await setDeadline(nobody, Date.now() - 8 * DAY);
    const recent = await activeBattle();
    await setDeadline(recent, Date.now() - 2 * DAY);

    expect(await resolveAbandonedDeadlines(getDb(env.DB))).toBe(2);
    expect(await status(delivered)).toMatchObject({
      status: 'decided',
      decisionReason: 'deadline',
    });
    expect((await ratings())[ben.user.id]?.r).toBeGreaterThan(1500);
    expect(await status(nobody)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'deadline_missed',
    });
    expect((await status(recent)).status).toBe('active');
  });
});

describe('chat', () => {
  it('lets only the participants talk and marks new messages as unread', async () => {
    const id = await activeBattle();
    const send = (who: Person, body: string) =>
      call(`/api/battles/${id}/messages`, { session: who.session, body: { body } });
    expect((await send(anna, 'Good luck!')).status).toBe(201);
    expect((await send(carla, 'Can I join?')).status).toBe(403);
    expect((await send(anna, '   ')).status).toBe(400);

    const unread = async (who: Person) => {
      const { body } = await json<{ battles: { id: string; unreadMessages: number }[] }>(
        call('/api/battles/mine', { session: who.session }),
      );
      return body.battles.find((b) => b.id === id)?.unreadMessages;
    };
    expect(await unread(ben)).toBe(1);
    expect(await unread(anna)).toBe(0);

    const read = await json<{ messages: { body: string; senderId: string }[] }>(
      call(`/api/battles/${id}/messages`, { session: ben.session }),
    );
    expect(read.body.messages).toMatchObject([{ body: 'Good luck!', senderId: anna.user.id }]);
    expect(await unread(ben)).toBe(0);
    expect((await call(`/api/battles/${id}/messages`, { session: carla.session })).status).toBe(
      403,
    );
  });
});

describe('my battles', () => {
  it('lists battles I take part in or am challenged to', async () => {
    await createBattle(anna);
    await createBattle(carla, { invitedUserId: anna.user.id });
    await createBattle(ben);
    const { body } = await json<{ battles: { createdBy: string }[] }>(
      call('/api/battles/mine', { session: anna.session }),
    );
    expect(body.battles.map((b) => b.createdBy).sort()).toEqual(
      [anna.user.id, carla.user.id].sort(),
    );
  });
});
