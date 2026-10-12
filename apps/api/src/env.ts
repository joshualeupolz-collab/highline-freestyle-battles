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
  /** R2 bucket with the videos (wrangler.jsonc). Only accessed through src/storage/videoStore.ts. */
  VIDEOS: R2Bucket;
  /** Name of that bucket, needed for signed URLs. */
  R2_BUCKET_NAME: string;
  /**
   * R2 access key for signed upload/download URLs (secrets). Without them, video bytes go
   * through the Worker instead (see videoStore.ts); fine locally, limited to 100 MB per upload.
   */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  /** Web Push keys (secrets, `npx web-push generate-vapid-keys`). Without them, no pushes. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Contact for the push services (`mailto:…` or https URL). */
  VAPID_SUBJECT?: string;
}

/** Values set by middleware for the current request. */
export interface Variables {
  /** The logged-in user, or null. */
  user: CurrentUser | null;
  /** Hash of the current session token, if logged in. */
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
