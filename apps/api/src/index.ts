import { createApp } from './app';
import { getDb } from './db/client';
import type { Env } from './env';
import { resolveAbandonedDeadlines } from './services/battles';
import { resolveExpiredReviews } from './services/review';
import { removeStaleUploads } from './services/videos';
import { videoStore } from './storage/videoStore';

const app = createApp();

export default {
  fetch: app.fetch,

  /** Cron trigger (wrangler.jsonc, hourly): background clean-up that needs no user action. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = getDb(env.DB);
    ctx.waitUntil(
      resolveAbandonedDeadlines(db).then((n) => console.log(`resolved ${n} abandoned battles`)),
    );
    ctx.waitUntil(
      resolveExpiredReviews(db).then((n) => console.log(`settled ${n} expired reviews`)),
    );
    ctx.waitUntil(
      removeStaleUploads(db, videoStore(env)).then((n) =>
        console.log(`removed ${n} unfinished uploads`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
