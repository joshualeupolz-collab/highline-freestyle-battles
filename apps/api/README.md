# @hfb/api

Cloudflare Worker with the HTTP API (Hono + Drizzle on D1). Later it will also serve the web app
as static assets (see `docs/architecture.md`).

## Local development

```bash
pnpm --filter @hfb/api db:migrate:local   # create/update the local database (.wrangler/)
pnpm --filter @hfb/api dev                # http://localhost:8787/api/health
```

No Cloudflare account is needed for local development or tests.

## Endpoints (so far)

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Worker and database are reachable |
| GET | `/api/formats` | Formats that are not archived, with the parts of their latest version |
| GET | `/api/rulesets/current` | The RuleSet that applies now |
| GET | `/api/rulesets/:version` | One RuleSet version |

## Database

- `src/db/schema.ts` is the source of truth. After changing it, run
  `pnpm --filter @hfb/api db:generate` to create the next migration in `db/migrations/`.
- Never edit a migration that has already been applied anywhere; add a new one.
- Enum values live in `src/db/enums.ts`. They are CHECK constraints in SQLite, and changing a
  CHECK later means rebuilding the table, so values for later stages are already included.

## Tests

`pnpm --filter @hfb/api test` runs the tests inside the real Workers runtime (Miniflare) via
`@cloudflare/vitest-plugin`. Before each test the database is reset and all migrations are applied.
