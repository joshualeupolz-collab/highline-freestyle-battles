import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}

const report = (session: string | null, body: Record<string, unknown>) =>
  call('/api/reports', {
    session,
    body: { category: 'other', text: 'Something is wrong here', ...body },
  });

interface ReportRow {
  id: string;
  targetType: string;
  battleId: string | null;
  involved: { username: string }[];
  reporter: { username: string };
  canHandle: boolean;
  closeNote: string | null;
}

describe('reports', () => {
  it('athletes report profiles and battles; the federation sees and closes them', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    const fed = await registerAthlete('fed', admin.session);
    await call(`/api/users/${fed.user.id}/roles`, {
      session: admin.session,
      body: { role: 'federation' },
    });
    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: anna.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: ben.session });

    expect(
      (
        await report(anna.session, {
          targetType: 'user',
          targetId: ben.user.id,
          category: 'fake_account',
        })
      ).status,
    ).toBe(201);
    expect((await report(anna.session, { targetType: 'user', targetId: ben.user.id })).status).toBe(
      409,
    );
    expect((await report(ben.session, { targetType: 'battle', targetId: battle.id })).status).toBe(
      201,
    );
    expect((await report(ben.session, { targetType: 'battle', targetId: 'nope' })).status).toBe(
      404,
    );
    expect((await report(ben.session, { targetType: 'user', targetId: ben.user.id })).status).toBe(
      400,
    );

    // Athletes cannot see the list; the federation can.
    expect((await call('/api/reports', { session: anna.session })).status).toBe(403);
    const list = await json<{ reports: ReportRow[] }>(
      call('/api/reports', { session: fed.session }),
    );
    expect(list.reports).toHaveLength(2);
    const [aboutBen, aboutBattle] = list.reports;
    expect(aboutBen).toMatchObject({
      targetType: 'user',
      reporter: { username: 'anna' },
      canHandle: true,
    });
    expect(aboutBattle?.battleId).toBe(battle.id);
    expect(aboutBattle?.involved.map((p) => p.username).sort()).toEqual(['anna', 'ben']);
    expect(
      (await json<{ count: number }>(call('/api/reports/open-count', { session: fed.session })))
        .count,
    ).toBe(2);

    // Closing needs a note and is audited; the reporter sees "closed", not the note.
    const close = await call(`/api/reports/${aboutBen?.id}/close`, {
      session: fed.session,
      body: { note: 'Checked, real person.' },
    });
    expect(close.status).toBe(200);
    const mine = await json<{ reports: { status: string; closeNote?: string }[] }>(
      call('/api/reports/mine', { session: anna.session }),
    );
    expect(mine.reports[0]?.status).toBe('closed');
    expect(mine.reports[0]?.closeNote).toBeUndefined();
    const closed = await json<{ reports: ReportRow[] }>(
      call('/api/reports?status=closed', { session: fed.session }),
    );
    expect(closed.reports[0]?.closeNote).toBe('Checked, real person.');
    const log = await json<{ entries: { action: string; reason: string }[] }>(
      call('/api/audit', { session: fed.session }),
    );
    expect(log.entries[0]).toMatchObject({
      action: 'report.close',
      reason: 'Checked, real person.',
    });
  });

  it('nobody handles a report about themselves or their own battle', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: admin.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: anna.session });
    await report(anna.session, { targetType: 'user', targetId: admin.user.id });
    await report(anna.session, { targetType: 'battle', targetId: battle.id });

    const list = await json<{ reports: ReportRow[] }>(
      call('/api/reports', { session: admin.session }),
    );
    expect(list.reports.map((r) => r.canHandle)).toEqual([false, false]);
    for (const r of list.reports) {
      const res = await call(`/api/reports/${r.id}/close`, {
        session: admin.session,
        body: { note: 'Nothing to see' },
      });
      expect(res.status).toBe(403);
    }
  });
});
