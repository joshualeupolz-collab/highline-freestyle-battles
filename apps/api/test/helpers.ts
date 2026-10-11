import { env } from 'cloudflare:workers';
import { createApp } from '../src/app';

const app = createApp();

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** Session token from an earlier response (see `sessionToken`). */
  session?: string | null;
  headers?: Record<string, string>;
}

/** Calls the API like a browser on the same origin would. */
export function call(path: string, options: CallOptions = {}) {
  // Browsers send Origin with every POST; same origin as the API here.
  const headers: Record<string, string> = { Origin: 'http://localhost', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] ??= 'application/json';
  if (options.session) headers.Cookie = `hfb_session=${options.session}`;
  return app.request(
    path,
    {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env,
  );
}

/** The session token a response sets, or undefined. */
export function sessionToken(res: Response): string | undefined {
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return /hfb_session=([^;]*)/.exec(cookie)?.[1] || undefined;
}

export const PASSWORD = 'a-long-test-password';

export async function register(username: string, extra: Record<string, unknown> = {}) {
  const res = await call('/api/auth/register', {
    body: { username, displayName: username, password: PASSWORD, ageConfirmed: true, ...extra },
  });
  const body = (await res.json()) as {
    user: { id: string; status: string; roles: string[] };
    error?: string;
  };
  return { res, body, user: body.user, session: sessionToken(res) ?? null };
}

/** The first admin, created with the setup token. */
export function registerAdmin(username = 'admin') {
  return register(username, { setupToken: 'test-setup-token' });
}

/** An approved athlete. */
export async function registerAthlete(username: string, approverSession: string | null) {
  const athlete = await register(username);
  await call(`/api/users/${athlete.user.id}/approve`, { method: 'POST', session: approverSession });
  return athlete;
}
