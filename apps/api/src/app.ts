import { Hono } from 'hono';
import type { AppEnv } from './env';
import { formatRoutes } from './routes/formats';
import { rulesetRoutes } from './routes/rulesets';

/** The HTTP API. Every route lives under `/api`; everything else will be the web app. */
export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api');

  app.get('/health', async (c) => {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok' });
  });
  app.route('/formats', formatRoutes);
  app.route('/rulesets', rulesetRoutes);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}
