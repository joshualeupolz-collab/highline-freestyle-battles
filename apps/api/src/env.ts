import type { CurrentUser } from '@hfb/shared';

/** Bindings of the Worker: resources from wrangler.jsonc and secrets. */
export interface Env {
  DB: D1Database;
  /**
   * Secret mixed into every password hash. Kept outside the database (Cloudflare secret,
   * `.dev.vars` locally). Must never change, or no password matches any more.
   */
  PASSWORD_PEPPER: string;
  /** Optional one-time secret that turns the first registered account into an admin. */
  SETUP_TOKEN?: string;
}

/** Values set by middleware for the current request. */
export interface Variables {
  /** The logged-in user, or null. */
  user: CurrentUser | null;
  /** Hash of the current session token, if logged in. */
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
