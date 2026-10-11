import { createApp } from './app';
import { getDb } from './db/client';
import type { Env } from './env';
import { resolveAbandonedDeadlines } from './services/battles';

const app = createApp();

export default {
  fetch: app.fetch,

  /** Cron trigger (wrangler.jsonc, hourly): background clean-up that needs no user action. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      resolveAbandonedDeadlines(getDb(env.DB)).then((n) =>
        console.log(`resolved ${n} abandoned battles`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
