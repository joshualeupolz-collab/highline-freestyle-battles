import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { resolveSession } from './session';

/** Sets `c.var.user` and `c.var.sessionId` from the session cookie (or null). */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await resolveSession(c, getDb(c.env.DB));
  c.set('user', session?.user ?? null);
  c.set('sessionId', session?.sessionId ?? null);
  await next();
};

/** Requires a logged-in user. With `active`, the account must also be approved. */
export function requireUser(options: { active?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) apiError(401, 'not_logged_in');
    if (options.active && user.status !== 'active') apiError(403, 'account_not_approved');
    await next();
  };
}
