import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPush, vapidToken } from '../src/services/push';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';

type Person = Awaited<ReturnType<typeof registerAthlete>>;

async function json<T>(res: Response | Promise<Response>) {
  return (await (await res).json()) as T;
}
const pending = (p: Person) =>
  json<{ notifications: { kind: string; title: string; body: string; url: string }[] }>(
    call('/api/notifications/pending', { session: p.session }),
  );

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** A VAPID key pair like `npx web-push generate-vapid-keys` prints. */
async function vapidPair() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { pair, publicKey: b64url(raw), privateKey: jwk.d as string };
}

afterEach(() => vi.restoreAllMocks());

describe('web push', () => {
  it('signs a VAPID token the push service can verify', async () => {
    const { pair, publicKey, privateKey } = await vapidPair();
    const token = await vapidToken(
      'https://fcm.googleapis.com/fcm/send/abc',
      { publicKey, privateKey, subject: 'mailto:test@example.org' },
      1_800_000_000_000,
    );
    const [header, payload, signature] = token.split('.');
    const decode = (s: string) => JSON.parse(atob(s.replaceAll('-', '+').replaceAll('_', '/')));
    expect(decode(header ?? '')).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decode(payload ?? '')).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_800_000_000 + 12 * 3600,
      sub: 'mailto:test@example.org',
    });
    const sig = Uint8Array.from(
      atob((signature ?? '').replaceAll('-', '+').replaceAll('_', '/')),
      (c) => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      sig,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it('sends an empty push and reports a subscription that is gone', async () => {
    const { publicKey, privateKey } = await vapidPair();
    const keys = { publicKey, privateKey, subject: 'mailto:test@example.org' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    expect((await sendPush('https://push.example.org/a', keys)).outcome).toBe('sent');
    expect((await sendPush('https://push.example.org/b', keys)).outcome).toBe('gone');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(headers['Content-Length']).toBe('0');
    // Android holds back pushes of normal urgency while the phone sleeps.
    expect(headers.Urgency).toBe('high');
  });
});

describe('notifications', () => {
  it('tells the challenger that the battle was accepted; chat messages without a flood', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: anna.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: ben.session });

    const first = await pending(anna);
    expect(first.notifications).toEqual([
      {
        id: expect.any(String),
        kind: 'accepted',
        title: 'Battle accepted',
        body: 'ben accepted your Best Trick battle.',
        url: `/battles/${battle.id}`,
      },
    ]);
    // Delivered once.
    expect((await pending(anna)).notifications).toEqual([]);
    expect((await pending(ben)).notifications).toEqual([]);

    for (const body of ['Hi', 'Are you there?'])
      await call(`/api/battles/${battle.id}/messages`, { session: ben.session, body: { body } });
    const chat = await pending(anna);
    expect(chat.notifications.map((n) => n.body)).toEqual(['ben wrote in your Best Trick battle.']);
  });

  it('kinds turned off in the profile are not notified', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    expect(await json(call('/api/push/settings', { session: anna.session }))).toEqual({ off: [] });
    const put = await call('/api/push/settings', {
      method: 'PUT',
      session: anna.session,
      body: { off: ['chat', 'chat'] },
    });
    expect(await json(put)).toEqual({ off: ['chat'] });
    const bad = await call('/api/push/settings', {
      method: 'PUT',
      session: anna.session,
      body: { off: ['everything'] },
    });
    expect(bad.status).toBe(400);

    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: anna.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: ben.session });
    await call(`/api/battles/${battle.id}/messages`, {
      session: ben.session,
      body: { body: 'Hi' },
    });
    expect((await pending(anna)).notifications.map((n) => n.kind)).toEqual(['accepted']);
  });

  it('a test push reports what the push service answered', async () => {
    const admin = await registerAdmin();
    const { publicKey, privateKey } = await vapidPair();
    const saved = { ...env };
    Object.assign(env, { VAPID_PUBLIC_KEY: `${publicKey}\n`, VAPID_PRIVATE_KEY: privateKey });
    try {
      const endpoint = 'https://push.example.org/device';
      const notMine = await call('/api/push/test', { session: admin.session, body: { endpoint } });
      expect(notMine.status).toBe(404);
      await call('/api/push/subscribe', { session: admin.session, body: { endpoint } });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('invalid JWT provided', { status: 403 }),
      );
      const res = await call('/api/push/test', { session: admin.session, body: { endpoint } });
      expect(await json(res)).toEqual({
        outcome: 'failed',
        status: 403,
        detail: 'invalid JWT provided',
      });
      expect((await pending(admin)).notifications.map((n) => n.title)).toEqual([
        'Test notification',
      ]);
    } finally {
      for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const)
        if (!(k in saved)) delete (env as unknown as Record<string, unknown>)[k];
    }
  });

  it('push needs the VAPID keys; without them the app learns that', async () => {
    const admin = await registerAdmin();
    const key = await json<{ publicKey: string | null }>(
      call('/api/push/key', { session: admin.session }),
    );
    expect(key.publicKey).toBeNull();
    const res = await call('/api/push/subscribe', {
      session: admin.session,
      body: { endpoint: 'https://push.example.org/x' },
    });
    expect(res.status).toBe(503);
  });

  it('a pool tells the athletes in range that a review waits', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    const rev = await registerAthlete('rev', admin.session);
    const far = await registerAthlete('far', admin.session);
    for (const [p, r] of [
      [anna, 1500],
      [ben, 1500],
      [rev, 1550],
      [far, 2400],
    ] as const)
      await env.DB.prepare(
        `INSERT INTO rating_states (user_id, format_id, r, rd, sigma, last_event_at, n_battles, ruleset_version, computed_at)
         VALUES (?, ?, ?, 80, 0.06, ?, 10, 1, ?)`,
      )
        .bind(p.user.id, BEST_TRICK, r, Date.now(), Date.now())
        .run();
    const { battle } = await json<{ battle: { id: string } }>(
      call('/api/battles', { session: anna.session, body: { formatId: BEST_TRICK } }),
    );
    await call(`/api/battles/${battle.id}/accept`, { method: 'POST', session: ben.session });
    await env.DB.prepare("UPDATE battles SET status = 'reviewing', played_at = ? WHERE id = ?")
      .bind(Date.now(), battle.id)
      .run();
    await call(`/api/battles/${battle.id}/vote`, { session: anna.session, body: { value: 1 } });
    await call(`/api/battles/${battle.id}/vote`, { session: ben.session, body: { value: -1 } });
    await call(`/api/battles/${battle.id}/escalate`, { method: 'POST', session: anna.session });

    expect((await pending(rev)).notifications.map((n) => n.kind)).toEqual(['review']);
    expect((await pending(far)).notifications).toEqual([]);
  });
});
