import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}

/** Anna challenges Ben, gives up, Ben counts it as a win: a decided, rated battle. */
async function decidedBattle(adminSession: string | null) {
  const anna = await registerAthlete('anna', adminSession);
  const ben = await registerAthlete('ben', adminSession);
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
  await call(`/api/battles/${battle.id}/proposals/${proposed.battle.proposals[0]?.id}/respond`, {
    session: ben.session,
    body: { decision: 'reject' },
  });
  return { anna, ben, battleId: battle.id };
}

const annul = (session: string | null, battleId: string, reason = 'Fake accounts') =>
  call(`/api/battles/${battleId}/annul`, { session, body: { reason } });

interface BattleView {
  battle: {
    status: string;
    annulment: { state: string; reason: string; ratingsPending?: boolean } | null;
  };
}

async function openReplays() {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM replay_requests WHERE done_at IS NULL',
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('annulment', () => {
  it('the federation annuls a decided battle; a replay is requested', async () => {
    const admin = await registerAdmin();
    const fed = await registerAthlete('fed', admin.session);
    await call(`/api/users/${fed.user.id}/roles`, {
      session: admin.session,
      body: { role: 'federation' },
    });
    const { anna, battleId } = await decidedBattle(admin.session);

    expect((await annul(anna.session, battleId)).status).toBe(403);
    expect((await annul(fed.session, battleId)).status).toBe(200);
    expect((await annul(fed.session, battleId)).status).toBe(409);

    const view = await json<BattleView>(
      call(`/api/battles/${battleId}`, { session: anna.session }),
    );
    expect(view.battle.status).toBe('annulled');
    expect(view.battle.annulment).toMatchObject({
      state: 'annulled',
      reason: 'Fake accounts',
      ratingsPending: true,
    });
    expect(await openReplays()).toBe(1);
    const log = await json<{ entries: { action: string; targetId: string }[] }>(
      call('/api/audit?targetType=battle', { session: fed.session }),
    );
    expect(log.entries[0]).toMatchObject({ action: 'battle.annul', targetId: battleId });
  });

  it('an admin annuls alone while there is no federation member', async () => {
    const admin = await registerAdmin();
    const { battleId } = await decidedBattle(admin.session);
    expect(await json(annul(admin.session, battleId))).toEqual({ status: 'annulled' });
  });

  it("an admin's annulment needs a federation member's approval", async () => {
    const admin = await registerAdmin();
    const fed = await registerAthlete('fed', admin.session);
    await call(`/api/users/${fed.user.id}/roles`, {
      session: admin.session,
      body: { role: 'federation' },
    });
    const { battleId, anna } = await decidedBattle(admin.session);

    const res = await annul(admin.session, battleId);
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect((await annul(admin.session, battleId)).status).toBe(409);
    const pendingView = await json<BattleView>(
      call(`/api/battles/${battleId}`, { session: anna.session }),
    );
    expect(pendingView.battle).toMatchObject({
      status: 'decided',
      annulment: { state: 'pending', reason: 'Fake accounts' },
    });

    // The admin sees the request but cannot decide it; the federation member can.
    const forAdmin = await json<{ approvals: { canDecide: boolean; canWithdraw: boolean }[] }>(
      call('/api/federation-approvals', { session: admin.session }),
    );
    expect(forAdmin.approvals[0]).toMatchObject({ canDecide: false, canWithdraw: true });
    expect(
      (
        await call(`/api/federation-approvals/${id}/decide`, {
          session: admin.session,
          body: { decision: 'approve' },
        })
      ).status,
    ).toBe(403);
    const decide = await call(`/api/federation-approvals/${id}/decide`, {
      session: fed.session,
      body: { decision: 'approve', note: 'Agreed' },
    });
    expect(decide.status).toBe(200);

    const view = await json<BattleView>(
      call(`/api/battles/${battleId}`, { session: anna.session }),
    );
    expect(view.battle.status).toBe('annulled');
    const log = await json<{
      entries: {
        action: string;
        actor: { username: string };
        federationApprovalBy: { username: string } | null;
      }[];
    }>(call('/api/audit?targetType=battle', { session: fed.session }));
    expect(log.entries[0]).toMatchObject({
      action: 'battle.annul',
      actor: { username: 'admin' },
      federationApprovalBy: { username: 'fed' },
    });
  });

  it('a rejected or withdrawn request leaves the battle decided', async () => {
    const admin = await registerAdmin();
    const fed = await registerAthlete('fed', admin.session);
    await call(`/api/users/${fed.user.id}/roles`, {
      session: admin.session,
      body: { role: 'federation' },
    });
    const { battleId, anna } = await decidedBattle(admin.session);

    const first = (await (await annul(admin.session, battleId)).json()) as { id: string };
    await call(`/api/federation-approvals/${first.id}/decide`, {
      session: fed.session,
      body: { decision: 'reject', note: 'Result is fine' },
    });
    const second = (await (await annul(admin.session, battleId)).json()) as { id: string };
    expect(
      (
        await call(`/api/federation-approvals/${second.id}/withdraw`, {
          method: 'POST',
          session: admin.session,
        })
      ).status,
    ).toBe(200);

    const view = await json<BattleView>(
      call(`/api/battles/${battleId}`, { session: anna.session }),
    );
    expect(view.battle).toMatchObject({ status: 'decided', annulment: null });
    expect(await openReplays()).toBe(0);
  });

  it('nobody annuls a battle they took part in', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: admin.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: anna.session });
    const proposed = await json<{ battle: { proposals: { id: string }[] } }>(
      call(`/api/battles/${battle.id}/proposals`, {
        session: anna.session,
        body: { kind: 'cancel' },
      }),
    );
    await call(`/api/battles/${battle.id}/proposals/${proposed.battle.proposals[0]?.id}/respond`, {
      session: admin.session,
      body: { decision: 'reject' },
    });
    expect((await annul(admin.session, battle.id)).status).toBe(403);
  });
});
