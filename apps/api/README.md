# @hfb/api

Cloudflare Worker with the HTTP API (Hono + Drizzle on D1). Later it will also serve the web app
as static assets (see `docs/architecture.md`).

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # local secrets (once)
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
| POST | `/api/auth/register` | Sign up (account is `pending` until approved); logs in |
| POST | `/api/auth/login` | Log in with username + password |
| POST | `/api/auth/logout` | Log out this device |
| GET | `/api/auth/me` | The logged-in user with status and roles |
| POST | `/api/auth/password` | Change own password (logs out other devices) |
| POST | `/api/auth/reset-password` | Set a new password with a code from an admin/federation |
| GET | `/api/users/pending` | Accounts waiting for approval (approved athletes and up) |
| POST | `/api/users/:id/approve` | Approve an account; it becomes an athlete |
| POST | `/api/users/:id/password-reset-code` | One-time code to reset a password (federation/admin) |

Errors always look like `{ "error": "code", "message"?, "details"? }`.

## Secrets

| Name | Purpose |
|---|---|
| `PASSWORD_PEPPER` | Secret mixed into every password hash. Set once, never change it. |
| `SETUP_TOKEN` | Whoever registers with it while no admin exists becomes the first admin. |

Locally they come from `.dev.vars`; in production: `wrangler secret put PASSWORD_PEPPER`.

## Database

- `src/db/schema.ts` is the source of truth. After changing it, run
  `pnpm --filter @hfb/api db:generate` to create the next migration in `db/migrations/`.
- Never edit a migration that has already been applied anywhere; add a new one.
- Enum values live in `src/db/enums.ts`. They are CHECK constraints in SQLite, and changing a
  CHECK later means rebuilding the table, so values for later stages are already included.

## Tests

`pnpm --filter @hfb/api test` runs the tests inside the real Workers runtime (Miniflare) via
`@cloudflare/vitest-plugin`. Before each test the database is reset and all migrations are applied.
