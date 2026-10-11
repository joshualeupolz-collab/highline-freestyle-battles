/**
 * Accounts and login (concept section 3): sign-up, login, logout, current user, passwords.
 */
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from '@hfb/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { sha256Hex, timingSafeEqualText } from '../auth/crypto';
import { requireUser } from '../auth/middleware';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  loadCurrentUser,
  setSessionCookie,
} from '../auth/session';
import { getDb } from '../db/client';
import { passwordResetCodes, sessions, userRoles, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';

/** After this many failed logins in a row, the account is locked for LOCK_DURATION. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION = 15 * 60_000;

export const authRoutes = new Hono<AppEnv>();

/** Sign up. The account is `pending` until someone approves it (or it is the setup admin). */
authRoutes.post('/register', async (c) => {
  const input = await parseJson(c, registerRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${input.username})`)
    .get();
  if (taken) apiError(409, 'username_taken');
  if (input.email) {
    const emailTaken = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .get();
    if (emailTaken) apiError(409, 'email_taken');
  }

  // The very first admin: whoever knows the setup secret, as long as no admin exists yet.
  let isSetupAdmin = false;
  if (input.setupToken !== undefined) {
    const adminExists = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.role, 'admin'), isNull(userRoles.revokedAt)))
      .get();
    const configured = c.env.SETUP_TOKEN;
    if (adminExists || !configured || !timingSafeEqualText(input.setupToken, configured)) {
      apiError(403, 'invalid_setup_token');
    }
    isSetupAdmin = true;
  }

  const id = newId(now);
  const passwordHash = await hashPassword(input.password, c.env.PASSWORD_PEPPER);
  const insertUser = db.insert(users).values({
    id,
    username: input.username,
    displayName: input.displayName,
    email: input.email?.toLowerCase() ?? null,
    passwordHash,
    status: isSetupAdmin ? 'active' : 'pending',
    ageConfirmedAt: now,
    approvedAt: isSetupAdmin ? now : null,
    questionnaireJson: input.questionnaire ? JSON.stringify(input.questionnaire) : null,
    createdAt: now,
  });
  if (isSetupAdmin) {
    await db.batch([
      insertUser,
      db.insert(userRoles).values([
        { id: newId(now), userId: id, role: 'athlete', grantedAt: now },
        { id: newId(now), userId: id, role: 'admin', grantedAt: now },
      ]),
      auditInsert(
        db,
        { actorId: id, action: 'user.bootstrap_admin', targetType: 'user', targetId: id },
        now,
      ),
    ]);
  } else {
    await insertUser;
  }

  const session = await createSession(db, id, now);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user: await loadCurrentUser(db, id) }, 201);
});

authRoutes.post('/login', async (c) => {
  const input = await parseJson(c, loginRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const user = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${input.username})`)
    .get();
  if (!user?.passwordHash) {
    await dummyVerify(c.env.PASSWORD_PEPPER);
    apiError(401, 'invalid_credentials');
  }

  const locked =
    user.failedLoginCount >= MAX_FAILED_LOGINS &&
    user.lastFailedLoginAt !== null &&
    now - user.lastFailedLoginAt < LOCK_DURATION;
  if (locked)
    apiError(429, 'too_many_attempts', 'Too many failed logins. Try again in 15 minutes.');

  if (!(await verifyPassword(input.password, user.passwordHash, c.env.PASSWORD_PEPPER))) {
    await db
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1`, lastFailedLoginAt: now })
      .where(eq(users.id, user.id));
    apiError(401, 'invalid_credentials');
  }
  if (user.status === 'suspended' || user.status === 'deleted') apiError(403, 'account_disabled');

  const updates: Partial<typeof users.$inferInsert> = {};
  if (user.failedLoginCount > 0) {
    updates.failedLoginCount = 0;
    updates.lastFailedLoginAt = null;
  }
  if (needsRehash(user.passwordHash)) {
    updates.passwordHash = await hashPassword(input.password, c.env.PASSWORD_PEPPER);
  }
  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, user.id));
  }

  const session = await createSession(db, user.id, now);
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user: await loadCurrentUser(db, user.id) });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = c.get('sessionId');
  if (sessionId) await getDb(c.env.DB).delete(sessions).where(eq(sessions.id, sessionId));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireUser(), (c) => c.json({ user: c.get('user') }));

/** Change one's own password. Other sessions (e.g. other devices) are logged out. */
authRoutes.post('/password', requireUser(), async (c) => {
  const input = await parseJson(c, changePasswordRequestSchema);
  const db = getDb(c.env.DB);
  const user = c.get('user');
  const sessionId = c.get('sessionId');
  if (!user || !sessionId) apiError(401, 'not_logged_in');

  const row = await db.select().from(users).where(eq(users.id, user.id)).get();
  if (
    !row?.passwordHash ||
    !(await verifyPassword(input.currentPassword, row.passwordHash, c.env.PASSWORD_PEPPER))
  ) {
    apiError(403, 'wrong_password');
  }
  const passwordHash = await hashPassword(input.newPassword, c.env.PASSWORD_PEPPER);
  await db.batch([
    db.update(users).set({ passwordHash }).where(eq(users.id, user.id)),
    db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, sessionId))),
  ]);
  return c.json({ ok: true });
});

/** Set a new password with a code from an admin or the federation. Logs out all devices. */
authRoutes.post('/reset-password', async (c) => {
  const input = await parseJson(c, resetPasswordRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const id = await sha256Hex(input.code.toUpperCase());
  const code = await db
    .select()
    .from(passwordResetCodes)
    .where(eq(passwordResetCodes.id, id))
    .get();
  if (!code || code.usedAt !== null || code.expiresAt <= now) apiError(400, 'invalid_code');

  const passwordHash = await hashPassword(input.newPassword, c.env.PASSWORD_PEPPER);
  await db.batch([
    db
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lastFailedLoginAt: null })
      .where(eq(users.id, code.userId)),
    db.update(passwordResetCodes).set({ usedAt: now }).where(eq(passwordResetCodes.id, id)),
    db.delete(sessions).where(eq(sessions.userId, code.userId)),
  ]);
  return c.json({ ok: true });
});
