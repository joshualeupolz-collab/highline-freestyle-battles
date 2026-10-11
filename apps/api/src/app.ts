import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { loadUser } from './auth/middleware';
import type { AppEnv } from './env';
import { authRoutes } from './routes/auth';
import { battleRoutes } from './routes/battles';
import { formatRoutes } from './routes/formats';
import { rulesetRoutes } from './routes/rulesets';
import { userRoutes } from './routes/users';
import { battleVideoRoutes, videoRoutes } from './routes/videos';

/** The HTTP API. Every route lives under `/api`; everything else will be the web app. */
export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api');

  // Rejects cross-site form posts; JSON-only bodies (parseJson) do the rest.
  app.use(csrf());
  app.use(loadUser);

  app.get('/health', async (c) => {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok' });
  });
  app.route('/formats', formatRoutes);
  app.route('/rulesets', rulesetRoutes);
  app.route('/auth', authRoutes);
  app.route('/users', userRoutes);
  app.route('/battles', battleRoutes);
  app.route('/battles', battleVideoRoutes);
  app.route('/videos', videoRoutes);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}
