/**
 * Notifications (concept §14 stage 2, owner 2026-10-12): opponent accepted, videos unlocked,
 * review needed, chat message – not new challenges. Each kind can be turned off in the profile
 * (`users.notify_off_json`). Each is a row in `notifications`; if the
 * person allowed push on a device, an empty push wakes the app, which fetches the rows
 * (GET /api/notifications/pending) and shows them.
 */
import type { NotificationKind as SettableKind } from '@hfb/shared';
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import { type Database, getDb } from '../db/client';
import { battles, formats, notifications, pushSubscriptions, users } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { newId } from '../lib/ids';
import { sendPush, type VapidKeys } from './push';

/** The kinds a person can turn off, plus the test from the profile. */
export type NotificationKind = SettableKind | 'test';

/** At most one chat notification per battle and person in this time (no flood of pushes). */
const CHAT_QUIET_MS = 15 * 60_000;
/** Notifications are fetched once; older ones are not needed any more. */
export const NOTIFICATION_KEEP_DAYS = 30;

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    // Copied secrets sometimes carry spaces, line breaks or base64 padding.
    publicKey: env.VAPID_PUBLIC_KEY.trim().replace(/=+$/, ''),
    privateKey: env.VAPID_PRIVATE_KEY.trim().replace(/=+$/, ''),
    subject:
      env.VAPID_SUBJECT?.trim() ||
      'https://highline-freestyle-battles.highlinefreestyle.workers.dev',
  };
}

export interface NotifyContext {
  db: Database;
  env: Env;
  /** Lets the pushes go out after the response (executionCtx.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The context of a request; pushes go out after the response where the runtime allows it. */
export function requestNotifyContext(c: Context<AppEnv>): NotifyContext {
  let waitUntil: NotifyContext['waitUntil'];
  try {
    const ctx = c.executionCtx;
    waitUntil = (p) => ctx.waitUntil(p);
  } catch {
    // No execution context (e.g. app.request in tests): send before answering.
  }
  return { db: getDb(c.env.DB), env: c.env, waitUntil };
}

/**
 * Notify people (never the actor). Writes the rows now; the pushes go out in the background.
 */
export async function notify(
  ctx: NotifyContext,
  input: { userIds: readonly string[]; kind: NotificationKind; battleId: string; actorId?: string },
  now = Date.now(),
) {
  let userIds = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (userIds.length > 0) {
    const settings = await ctx.db
      .select({ id: users.id, off: users.notifyOffJson })
      .from(users)
      .where(inArray(users.id, userIds));
    const muted = new Set(
      settings.filter((u) => turnedOff(u.off).includes(input.kind)).map((u) => u.id),
    );
    userIds = userIds.filter((id) => !muted.has(id));
  }
  if (input.kind === 'chat' && userIds.length > 0) {
    const recent = await ctx.db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, userIds),
          eq(notifications.battleId, input.battleId),
          eq(notifications.kind, 'chat'),
          isNull(notifications.deliveredAt),
          gt(notifications.createdAt, now - CHAT_QUIET_MS),
        ),
      );
    userIds = userIds.filter((id) => !recent.some((r) => r.userId === id));
  }
  if (userIds.length === 0) return;
  await ctx.db.insert(notifications).values(
    userIds.map((userId) => ({
      id: newId(now),
      userId,
      kind: input.kind,
      battleId: input.battleId,
      actorId: input.actorId ?? null,
      createdAt: now,
    })),
  );
  const keys = vapidKeys(ctx.env);
  if (!keys) return;
  const sending = pushTo(ctx.db, userIds, keys);
  if (ctx.waitUntil) ctx.waitUntil(sending);
  else await sending;
}

/** The kinds stored as turned off (unknown or broken values count as on). */
export function turnedOff(json: string | null): string[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function pushTo(db: Database, userIds: string[], keys: VapidKeys) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
  const results = await Promise.all(subs.map((s) => sendPush(s.endpoint, keys)));
  const gone = subs.filter((_, i) => results[i]?.outcome === 'gone').map((s) => s.id);
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
}

const TEXTS: Record<NotificationKind, { title: string; body: string }> = {
  accepted: { title: 'Battle accepted', body: '{actor} accepted your {format} battle.' },
  unlocked: {
    title: 'Videos unlocked',
    body: 'The videos of your {format} battle are ready: watch them and vote.',
  },
  review: { title: 'Review needed', body: 'A {format} battle waits for your review.' },
  chat: { title: 'New message', body: '{actor} wrote in your {format} battle.' },
  test: { title: 'Test notification', body: 'Notifications work on this device.' },
};

/**
 * The person's undelivered notifications as texts, marked delivered. Called by the service
 * worker when a push arrives (and by the app).
 */
export async function takePending(db: Database, userId: string, now = Date.now()) {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      battleId: notifications.battleId,
      actor: users.displayName,
      format: formats.name,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(battles, eq(battles.id, notifications.battleId))
    .leftJoin(formats, eq(formats.id, battles.formatId))
    .where(and(eq(notifications.userId, userId), isNull(notifications.deliveredAt)))
    .orderBy(notifications.createdAt)
    .limit(20);
  if (rows.length)
    await db
      .update(notifications)
      .set({ deliveredAt: now })
      .where(
        inArray(
          notifications.id,
          rows.map((r) => r.id),
        ),
      );
  return rows.map((r) => {
    const text = TEXTS[r.kind as NotificationKind] ?? TEXTS.chat;
    const fill = (s: string) =>
      s.replace('{actor}', r.actor ?? 'Someone').replace('{format}', r.format ?? '');
    return {
      id: r.id,
      kind: r.kind,
      title: text.title,
      body: fill(text.body),
      url: r.battleId ? `/battles/${r.battleId}` : '/',
    };
  });
}

/** Hourly job: notifications older than NOTIFICATION_KEEP_DAYS are not needed any more. */
export async function deleteOldNotifications(db: Database, now = Date.now()) {
  await db
    .delete(notifications)
    .where(lt(notifications.createdAt, now - NOTIFICATION_KEEP_DAYS * 86_400_000));
}
