/**
 * Push notifications: the app registers a device (`subscribe`), and when an empty push
 * arrives its service worker fetches the texts (`/notifications/pending`).
 */
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { getDb } from '../db/client';
import { pushSubscriptions } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { takePending, vapidKeys } from '../services/notify';

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

/** Mounted at /api/notifications. */
export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use(requireUser({ active: true }));

/** My undelivered notifications as texts; marks them delivered. */
notificationRoutes.get('/pending', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  return c.json({ notifications: await takePending(getDb(c.env.DB), user.id) });
});
