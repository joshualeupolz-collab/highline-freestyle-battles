/**
 * Login sessions. The browser keeps a random token in an HttpOnly cookie; the database stores
 * only its SHA-256, so a leaked database contains no usable sessions.
 */

import type { CurrentUser, Role } from '@hfb/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Database } from '../db/client';
import { sessions, userRoles, users } from '../db/schema';
import type { AppEnv } from '../env';
import { randomBytes, sha256Hex, toBase64Url } from './crypto';

export const SESSION_COOKIE = 'hfb_session';
const DAY = 86_400_000;
export const SESSION_DURATION = 30 * DAY;
/** Sessions are extended when less than this is left, so active users stay logged in. */
const SESSION_RENEW_BELOW = 15 * DAY;

export async function createSession(db: Database, userId: string, now = Date.now()) {
  const token = toBase64Url(randomBytes(32));
  const id = await sha256Hex(token);
  const expiresAt = now + SESSION_DURATION;
  await db.insert(sessions).values({ id, userId, expiresAt, createdAt: now });
  return { token, id, expiresAt };
}

export function setSessionCookie(c: Context<AppEnv>, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

export async function loadCurrentUser(db: Database, userId: string): Promise<CurrentUser | null> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
    roles: roles.map((r) => r.role as Role).sort(),
  };
}

/** Resolves the session cookie of a request. Expired sessions are removed. */
export async function resolveSession(c: Context<AppEnv>, db: Database, now = Date.now()) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const session = await db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session || session.expiresAt <= now) {
    if (session) await db.delete(sessions).where(eq(sessions.id, id));
    clearSessionCookie(c);
    return null;
  }
  const user = await loadCurrentUser(db, session.userId);
  if (!user || user.status === 'suspended' || user.status === 'deleted') {
    clearSessionCookie(c);
    return null;
  }
  if (session.expiresAt - now < SESSION_RENEW_BELOW) {
    const expiresAt = now + SESSION_DURATION;
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    setSessionCookie(c, token, expiresAt);
  }
  return { sessionId: id, user };
}
