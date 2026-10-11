import { env } from 'cloudflare:workers';
import { TERMS_VERSION } from '@hfb/shared';
import { describe, expect, it } from 'vitest';
import { LOCK_DURATION } from '../src/routes/auth';
import { call, PASSWORD, register, registerAdmin, registerAthlete, sessionToken } from './helpers';

async function login(username: string, password = PASSWORD) {
  return call('/api/auth/login', { body: { username, password } });
}

describe('sign-up', () => {
  it('creates a pending account and logs it in', async () => {
    const { res, user, session } = await register('anna', {
      email: 'Anna@Example.org',
      questionnaire: { freestyleSince: '2019', community: 'Berlin' },
    });
    expect(res.status).toBe(201);
    expect(user).toMatchObject({
      username: 'anna',
      status: 'pending',
      roles: [],
      email: 'anna@example.org',
    });
    expect(res.headers.get('Set-Cookie')).toMatch(/HttpOnly/);
    expect(res.headers.get('Set-Cookie')).toMatch(/SameSite=Lax/);

    const me = await call('/api/auth/me', { session });
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe('anna');
  });

  it('requires the age confirmation and valid input', async () => {
    const res = await call('/api/auth/register', {
      body: { username: 'anna', displayName: 'Anna', password: PASSWORD, ageConfirmed: false },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation_failed' });
    expect((await register('a b')).res.status).toBe(400);
    expect(
      (await call('/api/auth/register', { body: { username: 'x', password: 'short' } })).status,
    ).toBe(400);
  });

  it('requires accepting the terms and stores their version', async () => {
    const res = await call('/api/auth/register', {
      body: { username: 'anna', displayName: 'Anna', password: PASSWORD, ageConfirmed: true },
    });
    expect(res.status).toBe(400);
    const { user } = await register('anna');
    expect(user).toMatchObject({ termsVersion: TERMS_VERSION });
  });

  it('rejects a username that differs only in case', async () => {
    await register('Anna');
    const { res, body } = await register('anna');
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ error: 'username_taken' });
  });

  it('never stores the password itself', async () => {
    const { user } = await register('anna');
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$\d+\$/);
    expect(row?.password_hash).not.toContain(PASSWORD);
  });
});

describe('first admin with the setup token', () => {
  it('makes the first account an active admin, once', async () => {
    const { res, user } = await registerAdmin();
    expect(res.status).toBe(201);
    expect(user).toMatchObject({ status: 'active', roles: ['admin', 'athlete'] });
    const audit = await env.DB.prepare('SELECT action FROM audit_log WHERE target_id = ?')
      .bind(user.id)
      .first<{ action: string }>();
    expect(audit?.action).toBe('user.bootstrap_admin');

    const second = await registerAdmin('admin2');
    expect(second.res.status).toBe(403);
  });

  it('rejects a wrong token', async () => {
    const { res } = await register('eve', { setupToken: 'guess' });
    expect(res.status).toBe(403);
  });
});

describe('login', () => {
  it('logs in case-insensitively and logs out again', async () => {
    await register('Anna');
    const res = await login('anna');
    expect(res.status).toBe(200);
    const session = sessionToken(res);
    expect((await call('/api/auth/me', { session })).status).toBe(200);

    await call('/api/auth/logout', { method: 'POST', session });
    expect((await call('/api/auth/me', { session })).status).toBe(401);
  });

  it('gives the same answer for unknown users and wrong passwords', async () => {
    await register('anna');
    const wrong = await login('anna', 'wrong-password');
    const unknown = await login('nobody');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('locks the account for 15 minutes after 5 failed attempts', async () => {
    await register('anna');
    for (let i = 0; i < 5; i++) expect((await login('anna', 'wrong-password')).status).toBe(401);
    expect((await login('anna')).status).toBe(429);

    // After the lock period the correct password works again and resets the counter.
    await env.DB.prepare('UPDATE users SET last_failed_login_at = ?')
      .bind(Date.now() - LOCK_DURATION - 1)
      .run();
    expect((await login('anna')).status).toBe(200);
    const row = await env.DB.prepare('SELECT failed_login_count AS n FROM users').first<{
      n: number;
    }>();
    expect(row?.n).toBe(0);
  });

  it('refuses suspended accounts', async () => {
    const { user } = await register('anna');
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(user.id).run();
    expect((await login('anna')).status).toBe(403);
  });

  it('upgrades an old hash with fewer iterations at the next login', async () => {
    const { user } = await register('anna');
    const { hashPassword } = await import('../src/auth/password');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(PASSWORD, 'test-pepper', 1000), user.id)
      .run();
    expect((await login('anna')).status).toBe(200);
    const row = await env.DB.prepare('SELECT password_hash AS h FROM users').first<{ h: string }>();
    expect(row?.h).not.toMatch(/\$1000\$/);
  });
});

describe('approval', () => {
  it('lets an admin approve; the approved user becomes an athlete', async () => {
    const admin = await registerAdmin();
    const anna = await register('anna');

    const pending = await call('/api/users/pending', { session: admin.session });
    expect(
      ((await pending.json()) as { users: { username: string }[] }).users.map((u) => u.username),
    ).toEqual(['anna']);

    const res = await call(`/api/users/${anna.user.id}/approve`, {
      method: 'POST',
      session: admin.session,
    });
    expect(res.status).toBe(200);
    const me = (await (await call('/api/auth/me', { session: anna.session })).json()) as {
      user: { status: string; roles: string[] };
    };
    expect(me.user).toMatchObject({ status: 'active', roles: ['athlete'] });

    const row = await env.DB.prepare('SELECT approved_by FROM users WHERE id = ?')
      .bind(anna.user.id)
      .first<{ approved_by: string }>();
    expect(row?.approved_by).toBe(admin.user.id);
    expect(
      (await call(`/api/users/${anna.user.id}/approve`, { method: 'POST', session: admin.session }))
        .status,
    ).toBe(409);
  });

  it('lets any approved athlete approve, but not a pending user', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await register('ben');
    const carla = await register('carla');

    expect((await call('/api/users/pending', { session: ben.session })).status).toBe(403);
    expect(
      (await call(`/api/users/${carla.user.id}/approve`, { method: 'POST', session: ben.session }))
        .status,
    ).toBe(403);
    expect(
      (await call(`/api/users/${ben.user.id}/approve`, { method: 'POST', session: anna.session }))
        .status,
    ).toBe(200);
  });

  it('requires a login', async () => {
    expect((await call('/api/users/pending')).status).toBe(401);
  });
});

describe('passwords', () => {
  it('changing the password logs out other devices', async () => {
    const anna = await register('anna');
    const otherDevice = sessionToken(await login('anna'));
    const res = await call('/api/auth/password', {
      session: anna.session,
      body: { currentPassword: PASSWORD, newPassword: 'another-long-password' },
    });
    expect(res.status).toBe(200);
    expect((await call('/api/auth/me', { session: anna.session })).status).toBe(200);
    expect((await call('/api/auth/me', { session: otherDevice })).status).toBe(401);
    expect((await login('anna', 'another-long-password')).status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const anna = await register('anna');
    const res = await call('/api/auth/password', {
      session: anna.session,
      body: { currentPassword: 'wrong-password', newPassword: 'another-long-password' },
    });
    expect(res.status).toBe(403);
  });

  it('resets a password with a one-time code from an admin', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);

    const created = await call(`/api/users/${anna.user.id}/password-reset-code`, {
      method: 'POST',
      session: admin.session,
    });
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const reset = (c: string) =>
      call('/api/auth/reset-password', { body: { code: c, newPassword: 'brand-new-password' } });
    expect((await reset(code.toLowerCase())).status).toBe(200);
    expect((await reset(code)).status).toBe(400); // used up
    expect((await call('/api/auth/me', { session: anna.session })).status).toBe(401);
    expect((await login('anna')).status).toBe(401);
    expect((await login('anna', 'brand-new-password')).status).toBe(200);

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.password_reset_code'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('only lets the federation or an admin create codes, not for themselves', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    expect(
      (
        await call(`/api/users/${ben.user.id}/password-reset-code`, {
          method: 'POST',
          session: anna.session,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/api/users/${admin.user.id}/password-reset-code`, {
          method: 'POST',
          session: admin.session,
        })
      ).status,
    ).toBe(403);
  });
});

describe('request protection', () => {
  it('rejects cross-site form posts and non-JSON bodies', async () => {
    const form = await call('/api/auth/login', {
      body: 'username=anna',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.example',
      },
    });
    expect(form.status).toBe(403);
    const text = await call('/api/auth/login', {
      body: 'x',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(text.status).toBe(415);
  });
});

describe('user search', () => {
  it('finds active users by the start of their username, case-insensitively', async () => {
    const admin = await registerAdmin();
    await registerAthlete('Anna', admin.session);
    await registerAthlete('annika', admin.session);
    await registerAthlete('ben', admin.session);
    await register('anton'); // pending: not found
    const res = await call('/api/users/search?q=AN', { session: admin.session });
    const { users } = (await res.json()) as { users: { username: string }[] };
    expect(users.map((u) => u.username)).toEqual(['Anna', 'annika']);
    expect(
      (
        (await (await call('/api/users/search?q=a', { session: admin.session })).json()) as {
          users: unknown[];
        }
      ).users,
    ).toEqual([]);
  });

  it('uses the username index instead of scanning all users', async () => {
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM users WHERE lower(username) >= 'an' AND lower(username) < 'an\u{10FFFF}'",
    ).all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(' ')).toMatch(
      /USING INDEX users_username_unique/,
    );
  });
});

describe('terms of use', () => {
  it('lets an account accept the current version once more', async () => {
    const { user, session } = await register('anna');
    // An account from before the terms existed.
    await env.DB.prepare('UPDATE users SET terms_version = NULL WHERE id = ?').bind(user.id).run();
    const me = await call('/api/auth/me', { session });
    expect(((await me.json()) as { user: { termsVersion: null } }).user.termsVersion).toBeNull();

    const old = await call('/api/auth/accept-terms', { session, body: { version: '2000-01-01' } });
    expect(old.status).toBe(409);
    const res = await call('/api/auth/accept-terms', { session, body: { version: TERMS_VERSION } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { termsVersion: TERMS_VERSION } });
    const row = await env.DB.prepare('SELECT terms_accepted_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ terms_accepted_at: number }>();
    expect(row?.terms_accepted_at).toBeGreaterThan(0);
  });

  it('needs a login', async () => {
    const res = await call('/api/auth/accept-terms', { body: { version: TERMS_VERSION } });
    expect(res.status).toBe(401);
  });
});
