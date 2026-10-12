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
| GET | `/api/formats/:id` | One format with all versions |
| POST | `/api/formats` | Create a format (federation/admin) |
| PATCH | `/api/formats/:id` | Change name, description, status, kPoints (federation/admin) |
| POST | `/api/formats/:id/versions` | New version of the parts (federation/admin) |
| POST | `/api/formats/:id/archive` | Archive a format (federation/admin) |
| GET | `/api/rulesets` | All RuleSet versions |
| POST | `/api/rulesets` | New RuleSet version (federation/admin) |
| POST | `/api/battles` | Open request or direct challenge |
| GET | `/api/battles/open` | Requests I can accept, closest rating first |
| GET | `/api/battles/mine` | My battles |
| GET | `/api/battles/:id` | One battle with participants and pending proposals |
| POST | `/api/battles/:id/accept` | Accept a request |
| POST | `/api/battles/:id/retract` | Take back my open request |
| POST | `/api/battles/:id/start` | Start with the negotiated settings (accepting side) |
| POST | `/api/battles/:id/proposals` | Propose a change: `settings`, `extension`, `cancel`, `extra_attempt` (online), `result` (on site) |
| POST | `/api/battles/:id/proposals/:pid/respond` | Accept or reject a proposal |
| POST | `/api/battles/:id/proposals/:pid/withdraw` | Withdraw my proposal |
| POST | `/api/battles/:id/grant-attempt` | Give the opponent one extra attempt |
| POST | `/api/battles/:id/deadline-decision` | After a missed deadline: `claim_win` or `cancel` |
| POST | `/api/battles/:id/attempts` | Register an attempt (pressing Start); checks the attempt limit |
| POST | `/api/battles/onsite` | Enter an on-site result; the opponent confirms it via the `result` proposal |
| POST | `/api/battles/:id/withdraw-onsite` | On-site battle did not take place: end it unrated |
| POST | `/api/battles/:id/vote` | Review level 1: vote −2 … +2 (seen from seat 0); agreement decides and rates |
| POST | `/api/battles/:id/submissions` | Choose the attempt that counts; unlocks the videos once everyone has chosen |
| POST | `/api/videos` | Announce an upload; returns where to send the bytes |
| PUT | `/api/videos/:id/upload` | Upload through the Worker (only without R2 access key, e.g. locally) |
| POST | `/api/videos/:id/complete` | Check the stored file and mark the video as uploaded |
| GET | `/api/users/staff` | Everyone with a special role |
| POST | `/api/users/:id/roles` | Hand out a role (`grantableRoles`), audited |
| POST | `/api/users/:id/roles/revoke` | Take back a role, audited |
| GET | `/api/audit` | Audit log (federation/admin), `?before=<id>` for the next page |
| POST | `/api/reports` | Report a battle, video or profile |
| GET | `/api/reports/mine` | My reports and whether they were handled |
| GET | `/api/reports` | Reports for federation/admin (`?status=open|closed`) |
| GET | `/api/reports/open-count` | Number of open reports (badge) |
| POST | `/api/reports/:id/close` | Close a report with a note, audited |
| POST | `/api/battles/:id/annul` | Annul a decided battle (federation; admins need approval) |
| GET | `/api/federation-approvals` | Admin actions waiting for the federation |
| POST | `/api/federation-approvals/:id/decide` | Approve (carries it out) or reject |
| POST | `/api/federation-approvals/:id/withdraw` | The requester takes it back |
| POST | `/api/estimates` | Initial rating estimate (athletes; `official` for federation/admin) |
| GET | `/api/estimates?subjectId=` | My estimates of a person and the count (staff: all) |
| POST | `/api/estimates/:id/withdraw` | Withdraw my estimate |
| POST | `/api/battles/:id/escalate` | Level 1 without agreement: hand the battle to the pool |
| POST | `/api/battles/:id/pool-vote` | Level 2: one blind review by an eligible athlete |
| POST | `/api/battles/:id/judge-decision` | Level 3: the judge decides (audited) |
| GET | `/api/reviews/open` | Battles waiting for my review (pool or judge) |
| POST | `/api/battles/onsite-group` | Enter an on-site group battle with everyone's placement |
| POST | `/api/battles/:id/group-confirm` | Confirm the group result (counts once everyone did) |
| POST | `/api/battles/:id/group-reject` | Reject it (someone enters a corrected one) |
| POST | `/api/battles/:id/group-result` | Enter corrected placements |
| POST | `/api/battles/:id/official-confirm` | Judge/organizer/federation confirms for everyone (audited) |
| GET | `/api/competitions` | Competitions, newest first |
| POST | `/api/competitions` | Create one (organizer/federation), weight 1–5 |
| GET | `/api/competitions/:id` | Details, results and what the viewer may do |
| POST | `/api/competitions/:id/battles` | Organizer: add a single battle |
| POST | `/api/competitions/:id/placements` | Organizer: final placement of a format |
| POST | `/api/competitions/:id/results/:battleId/remove` | Organizer: remove a result |
| POST | `/api/competitions/:id/submit` / `reopen` / `cancel` | Organizer: ask for confirmation, edit again, call off |
| POST | `/api/competitions/:id/confirm` | Judge/federation: confirm, all results count (audited) |
| POST | `/api/auth/delete-account` | Delete one's own account (password, `keepVideos`); returns the deletion link token |
| POST | `/api/auth/deletion-request` | With the deletion link: delete the videos a deleted account kept |
| POST | `/api/rulesets/replay` | Request a full rating recalculation (federation/admin) |
| GET | `/api/videos/:id/file` | Watch a video (redirect to a signed R2 URL, or the bytes) |

Errors always look like `{ "error": "code", "message"?, "details"? }`.

## Secrets

| Name | Purpose |
|---|---|
| `PASSWORD_PEPPER` | Secret mixed into every password hash. Set once, never change it. |
| `SETUP_TOKEN` | Whoever registers with it while no admin exists becomes the first admin. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` | Optional: R2 access key for signed upload/download URLs. Without them, video bytes go through the Worker (fine locally; max 95 MB per video). |

Locally they come from `.dev.vars`; in production the deploy workflow sets them
(`docs/deployment.md`). Videos are stored in the R2 bucket `hfb-videos` (binding `VIDEOS`);
locally Wrangler simulates it in `.wrangler/`. All access goes through `src/storage/videoStore.ts`.

## Database

- `src/db/schema.ts` is the source of truth. After changing it, run
  `pnpm --filter @hfb/api db:generate` to create the next migration in `db/migrations/`.
- Never edit a migration that has already been applied anywhere; add a new one.
- Enum values live in `src/db/enums.ts`. They are CHECK constraints in SQLite, and changing a
  CHECK later means rebuilding the table, so values for later stages are already included.

## Rating replay

`pnpm --filter @hfb/api replay [--force] [--local]` recalculates all ratings from the raw data
(`scripts/replay.ts`, run daily by `.github/workflows/replay.yml`).

## Tests

`pnpm --filter @hfb/api test` runs the tests inside the real Workers runtime (Miniflare) via
`@cloudflare/vitest-plugin`. Before each test the database is reset and all migrations are applied.
