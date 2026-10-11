import { describe, expect, it } from 'vitest';
import { call, register, registerAdmin, registerAthlete } from './helpers';

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}

const grant = (session: string | null, userId: string, role: string, reason?: string) =>
  call(`/api/users/${userId}/roles`, { session, body: { role, reason } });
const revoke = (session: string | null, userId: string, role: string) =>
  call(`/api/users/${userId}/roles/revoke`, { session, body: { role } });
const rolesOf = async (session: string | null, userId: string) =>
  (await json<{ user: { roles: string[] } }>(call(`/api/users/${userId}`, { session }))).user.roles;

describe('roles', () => {
  it('admin hands out federation; the federation assigns judges, not admins', async () => {
    const admin = await registerAdmin();
    const fed = await registerAthlete('fed', admin.session);
    const judge = await registerAthlete('judge', admin.session);

    expect((await grant(admin.session, fed.user.id, 'federation', 'Board 2026')).status).toBe(201);
    expect(await rolesOf(admin.session, fed.user.id)).toEqual(['athlete', 'federation']);

    expect((await grant(fed.session, judge.user.id, 'judge')).status).toBe(201);
    expect((await grant(fed.session, judge.user.id, 'organizer')).status).toBe(201);
    expect((await grant(fed.session, judge.user.id, 'admin')).status).toBe(403);
    expect((await grant(fed.session, judge.user.id, 'judge')).status).toBe(409);
    expect(await rolesOf(fed.session, judge.user.id)).toEqual(['athlete', 'judge', 'organizer']);

    // The new role applies right away (roles are read per request).
    const me = await json<{ user: { roles: string[] } }>(
      call('/api/auth/me', { session: judge.session }),
    );
    expect(me.user.roles).toContain('judge');

    expect((await revoke(fed.session, judge.user.id, 'organizer')).status).toBe(200);
    expect((await revoke(fed.session, judge.user.id, 'organizer')).status).toBe(404);
    expect(await rolesOf(fed.session, judge.user.id)).toEqual(['athlete', 'judge']);

    const staff = await json<{ staff: { username: string; role: string }[] }>(
      call('/api/users/staff', { session: judge.session }),
    );
    expect(staff.staff.map((s) => `${s.role}:${s.username}`)).toEqual([
      'admin:admin',
      'federation:fed',
      'judge:judge',
    ]);
  });

  it('athletes cannot change roles, nobody changes their own, only active accounts', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    const pending = await register('pending');

    expect((await grant(anna.session, ben.user.id, 'judge')).status).toBe(403);
    expect((await grant(admin.session, admin.user.id, 'judge')).status).toBe(403);
    expect((await revoke(admin.session, admin.user.id, 'admin')).status).toBe(403);
    expect((await grant(admin.session, pending.user.id, 'judge')).status).toBe(409);
    expect((await grant(admin.session, ben.user.id, 'athlete')).status).toBe(400);
  });

  it('every change is in the audit log, which only federation and admins can read', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    await grant(admin.session, anna.user.id, 'judge', 'Certified in 2026');
    await revoke(admin.session, anna.user.id, 'judge');

    const log = await json<{
      entries: {
        action: string;
        actor: { username: string };
        targetUser: { username: string } | null;
        reason: string | null;
        payload: unknown;
      }[];
      next: string | null;
    }>(call('/api/audit', { session: admin.session }));
    expect(log.entries.slice(0, 3)).toMatchObject([
      { action: 'user.role_revoke', actor: { username: 'admin' }, payload: { role: 'judge' } },
      {
        action: 'user.role_grant',
        targetUser: { username: 'anna' },
        reason: 'Certified in 2026',
      },
      { action: 'user.approve', targetUser: { username: 'anna' } },
    ]);
    expect(log.next).toBeNull();

    const filtered = await json<{ entries: { action: string }[] }>(
      call(`/api/audit?targetType=user&targetId=${anna.user.id}`, { session: admin.session }),
    );
    expect(filtered.entries).toHaveLength(3);

    expect((await call('/api/audit', { session: anna.session })).status).toBe(403);
  });

  it('pages through a long audit log', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    for (let i = 0; i < 30; i++) {
      await grant(admin.session, anna.user.id, 'judge');
      await revoke(admin.session, anna.user.id, 'judge');
    }
    const first = await json<{ entries: { id: string }[]; next: string | null }>(
      call('/api/audit', { session: admin.session }),
    );
    expect(first.entries).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await json<{ entries: { id: string }[]; next: string | null }>(
      call(`/api/audit?before=${first.next}`, { session: admin.session }),
    );
    // 60 role changes and at least Anna's approval, none of them twice.
    const all = [...first.entries, ...second.entries].map((e) => e.id);
    expect(all.length).toBeGreaterThanOrEqual(61);
    expect(new Set(all).size).toBe(all.length);
    expect(second.next).toBeNull();
  });
});
