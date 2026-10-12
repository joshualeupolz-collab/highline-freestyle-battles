/**
 * Push notifications: the app registers a device (`subscribe`), and when an empty push
 * arrives its service worker fetches the texts (`/notifications/pending`).
 */
import { notificationSettingsSchema } from '@hfb/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { getDb } from '../db/client';
import { notifications, pushSubscriptions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { takePending, turnedOff, vapidKeys } from '../services/notify';
import { sendPush } from '../services/push';

const endpointSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .refine((u) => u.startsWith('https://'), 'https only'),
});

/** Mounted at /api/push. */
export const pushRoutes = new Hono<AppEnv>();
pushRoutes.use(requireUser({ active: true }));

/** The public VAPID key for `pushManager.subscribe` (null = push is not set up). */
pushRoutes.get('/key', (c) => c.json({ publicKey: vapidKeys(c.env)?.publicKey ?? null }));

/** Register this device for my notifications (an endpoint moves to whoever registers it). */
pushRoutes.post('/subscribe', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  if (!vapidKeys(c.env)) apiError(503, 'push_not_configured');
  const { endpoint } = await parseJson(c, endpointSchema);
  const db = getDb(c.env.DB);
  await db
    .insert(pushSubscriptions)
    .values({ id: newId(), userId: user.id, endpoint, createdAt: Date.now() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id } });
  return c.json({ ok: true }, 201);
});

/** This device no longer wants notifications. */
pushRoutes.post('/unsubscribe', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { endpoint } = await parseJson(c, endpointSchema);
  await getDb(c.env.DB)
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)));
  return c.json({ ok: true });
});

/**
 * Sends a test notification to this device and says what the push service answered, so a
 * device that gets nothing can be told apart from a push service that refuses.
 */
pushRoutes.post('/test', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const keys = vapidKeys(c.env);
  if (!keys) apiError(503, 'push_not_configured');
  const { endpoint } = await parseJson(c, endpointSchema);
  const db = getDb(c.env.DB);
  const sub = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)))
    .get();
  if (!sub) apiError(404, 'not_subscribed');
  const now = Date.now();
  await db
    .insert(notifications)
    .values({ id: newId(now), userId: user.id, kind: 'test', createdAt: now });
  const result = await sendPush(endpoint, keys);
  if (result.outcome === 'gone')
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
  return c.json(result);
});

/** The notification kinds I turned off (they count for all my devices). */
pushRoutes.get('/settings', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const row = await getDb(c.env.DB)
    .select({ off: users.notifyOffJson })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return c.json({ off: turnedOff(row?.off ?? null) });
});

pushRoutes.put('/settings', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { off } = await parseJson(c, notificationSettingsSchema);
  const unique = [...new Set(off)];
  await getDb(c.env.DB)
    .update(users)
    .set({ notifyOffJson: unique.length ? JSON.stringify(unique) : null })
    .where(eq(users.id, user.id));
  return c.json({ off: unique });
});

/** Mounted at /api/notifications. */
export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use(requireUser({ active: true }));

/** My undelivered notifications as texts; marks them delivered. */
notificationRoutes.get('/pending', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  return c.json({ notifications: await takePending(getDb(c.env.DB), user.id) });
});
