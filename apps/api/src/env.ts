/** Bindings of the Worker, configured in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
}

export type AppEnv = { Bindings: Env };
