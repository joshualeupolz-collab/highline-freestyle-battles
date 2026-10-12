# Architecture and implementation plan

As of 2026-10-11 · Technical decisions for stage 1, made with later stages in mind.
Basis: `docs/concept.md` and `rating/rating-specification.md`.

---

## 1. Decisions

| Area | Decision | Why |
|---|---|---|
| Frontend | **React + Vite**, built as a static single-page app, `vite-plugin-pwa` (Workbox), React Router, TanStack Query | Widest reach among possible contributors. No server-side rendering: static files cost no Worker requests. Recording and offline storage use plain browser APIs, independent of the framework. |
| Hosting | **One Cloudflare Worker with static assets** serves the app and the API (`/api/*`) | `*.pages.dev` and `*.workers.dev` are on the Public Suffix List. A separate Pages site and Worker would be two different sites, and Safari blocks the login cookie as a third-party cookie. One origin avoids this and needs no CORS. Static asset requests are free and unlimited; only `/api/*` counts towards the 100,000 requests/day. |
| API | **Hono** on Workers, input validation with **zod** | Small, fast, well documented, typed client for the frontend. |
| Database access | **Drizzle ORM**; migrations are plain SQL files in `db/migrations`, applied with `wrangler d1 migrations apply` | Types from the schema, migrations stay readable SQL. |
| Login | **Own small session login** (pattern from the "Copenhagen Book" / former Lucia guide), **arctic** for Google OAuth | Our needs are special (optional email, password reset by admin, approval, invitation tree, roles). Ready-made libraries (Better Auth) require an email address. The code stays small and fully tested. |
| Monorepo | **pnpm workspaces**, no Turborepo/Nx | Enough for a handful of packages; fewer tools for newcomers. |
| Lint/format | **Biome** | One fast tool instead of ESLint + Prettier. |
| Tests | **Vitest**; Worker tests with `@cloudflare/vitest-pool-workers` (real local D1) | |
| Texts | All user-facing texts in a message catalogue from the start (English only for now) | Easy to localize later. |
| CI | GitHub Actions: lint, typecheck, tests, check against the Python reference | Free for public repositories. |

### Passwords

Nobody can read a password, not even an admin. We store only:

- a **PBKDF2-SHA256 hash** with a random salt per user (native WebCrypto in the Worker, fast enough for the Workers CPU limit; scrypt/argon2 in JavaScript would be too slow there),
- combined with a secret **pepper** stored as a Cloudflare secret, not in the database. A stolen database alone is not enough to guess passwords.

In addition: minimum password length (8), session tokens stored only as hashes, and after 5 failed logins in a row the account is locked for 15 minutes.

**Iterations:** 100,000 PBKDF2 iterations (the Workers maximum) took ~17 ms of CPU in a measurement, above the ~10 ms of Workers Free. We start with **50,000**. Every hash stores its iteration count, so the value can be raised after measuring on Cloudflare; accounts are upgraded automatically at their next login.

### Accounts and login (implemented in step 3)

- **Session:** random token in an `HttpOnly; Secure; SameSite=Lax` cookie, valid 30 days, extended automatically while in use. Cross-site form posts are rejected (Origin check), and request bodies must be JSON.
- **Sign-up:** username (3–30 characters, case-insensitive unique), display name, password, optional e-mail, required age confirmation, optional questionnaire. The account is `pending` and logged in, so it can see that it waits for approval.
- **Approval:** any approved athlete, the federation or an admin. It stores who approved whom (invitation tree), grants the `athlete` role and is written to the audit log.
- **First admin:** whoever registers with the secret `SETUP_TOKEN` while no admin exists becomes an active admin. Afterwards the token has no effect.
- **Forgotten password:** there is no e-mail reset. The federation or an admin creates a one-time code (valid 24 h, shown once, stored only as a hash) and hands it over personally. Using it sets a new password and logs out all devices.
- **Google login** is postponed. It needs a Google Cloud project with an OAuth client, which the project owner has to create; the data model (`oauth_accounts`) is ready.

### Costs

Everything above stays within the free tiers. Activating R2 requires a payment method on the Cloudflare account; there are no charges within the free 10 GB.

---

## 2. Database schema (D1)

Implemented in `apps/api/src/db/schema.ts` (source of truth) and `db/migrations/0000_init.sql`; RuleSet 1 and the launch formats are seeded by `db/migrations/0001_seed_rules.sql`. All enum values are listed in `apps/api/src/db/enums.ts`.

### Conventions (so later stages need no rebuild)

- **IDs are TEXT (UUIDv7).** The phone can create them offline (attempts, videos), and they sort by time.
- Times are INTEGER (Unix milliseconds, UTC), booleans INTEGER 0/1, JSON is TEXT validated with zod.
- In SQLite a `CHECK` constraint can only be changed by rebuilding the table. **All enum checks therefore already contain the values of stages 2 and 3**; the app simply does not use them yet.
- Stages 2 and 3 only add **new tables or nullable columns**, which SQLite can do without a rebuild.
- Users are never hard-deleted (`status = deleted`, personal data removed), so battles and the opponents' ratings remain valid.
- **A battle is the "event" of the rating specification (§10).** A competition with only final placements is a battle with `kind = placement`. The engine reads decided battles only.

### Tables

```
-- Identity and permissions
users            id, username UNIQUE NOCASE, display_name, email NULL UNIQUE, password_hash NULL,
                 status (pending|active|suspended|deleted), age_confirmed_at, minor_consent_note NULL,
                 approved_by NULL → users, approved_at NULL,          -- invitation tree
                 questionnaire_json NULL, athlete_code NULL UNIQUE,   -- code used from stage 2
                 created_at, deleted_at NULL
oauth_accounts   provider, provider_user_id, user_id                  PK(provider, provider_user_id)
sessions         id (hash of the token), user_id, expires_at, created_at
user_roles       user_id, role (athlete|judge|organizer|federation|admin), granted_by, granted_at, revoked_at
audit_log        id, actor_id, action, target_type, target_id, reason, payload_json,
                 federation_approval_by NULL, created_at

-- Rules as data
rulesets         version PK, params_json, valid_from, note, created_by, created_at
formats          id, slug UNIQUE, name, description, status (relevant|fun), k_points,
                 merged_into NULL → formats, created_by, created_at, archived_at NULL
format_versions  format_id, version, parts_json, created_at           PK(format_id, version), immutable
                 -- parts_json: [{ kind: best_trick|trick_combo|bounce_combo|response, count, label }]
competitions     id, name, organizer_id, location, starts_at, ends_at, status, confirmed_by, created_at
                 -- table exists from the start, used from stage 2

-- Battles (= rating events)
battles          id, format_id, format_version, ruleset_version,
                 kind (single|group|placement), mode (online|onsite),
                 status (open|negotiating|active|reviewing|decided|cancelled|annulled),
                 level 1–5, level_approved_by NULL, level_approved_at NULL,
                 scoring (win_loss|scale|points|placement), review_mode (quick|detailed),
                 review_level 1–3, rounds DEFAULT 1,
                 attempts_per_video NULL (= unlimited), time_window_hours NULL, deadline_at NULL,
                 settings_flexible, competition_id NULL,
                 created_by, created_at, accepted_at, played_at, decided_at,
                 event_at,                        -- rating event timestamp (spec §2.1)
                 cancel_reason, annulled_by, annulled_at, annul_reason
battle_participants  battle_id, user_id, seat (0..n−1), joined_at, extra_attempts DEFAULT 0,
                 score NULL, points NULL, placement NULL          -- raw result
                 PK(battle_id, user_id), UNIQUE(battle_id, seat)
battle_proposals id, battle_id, kind (settings|result|draw|cancel|extra_attempt|extension),
                 payload_json, proposed_by, status (pending|accepted|rejected|withdrawn),
                 created_at, resolved_at
proposal_responses  proposal_id, user_id, decision (accept|reject), created_at

-- Recording and video
attempts         id (created on the phone), battle_id NULL, user_id, part_index, round,
                 started_at_client, synced_at,
                 recorded_by NULL, code_used NULL, opponent_name_entered NULL   -- stage 2
videos           id, attempt_id UNIQUE, owner_id, battle_id NULL (NULL = inbox, stage 2),
                 part_index, round, visibility (public|logged_in|review_only),
                 retention (delete_after_battle|keep), quality (saver|normal|hd),
                 duration_ms, trim_start_ms, trim_end_ms,
                 status (pending_upload|uploaded|processing|ready|deleted),
                 recorded_at, uploaded_at, deleted_at
video_files      id, video_id, kind (original|compressed|clip|thumbnail), clip_index NULL,
                 backend (r2|telegram|disk), locator, size_bytes, created_at, deleted_at
submissions      battle_id, user_id, part_index, round, video_id, submitted_at
                 PK(battle_id, user_id, part_index, round)        -- the attempt that counts

-- Review and rating
review_votes     battle_id, voter_id, review_level 1–3, value −2..+2 (seen from seat 0), created_at
rating_estimates id, subject_id, estimator_id, format_id, value, kind (admin|federation|athlete),
                 created_at, withdrawn_at NULL
rating_states    user_id, format_id, r, rd, sigma, last_event_at, n_battles, ruleset_version,
                 computed_at                                       -- derived, cache
rating_history   battle_id, user_id, format_id, r_before, r_after, rd_before, rd_after, sigma_after
replay_requests  id, format_id NULL, from_event_at, reason, requested_by, created_at, done_at NULL
```

Notes:

- `battle_proposals` implements core principle 2 ("everything can be changed if both sides agree") once, for settings changes, on-site results, draw confirmation, cancellation and goodwill. `proposal_responses` also works for n people.
- Added after the first deployment (all additive): `formats.approved_at/approved_by/review_note` (format proposals; `approved_at` NULL = proposal), `battle_messages` (chat) and `battle_participants.last_read_message_at` (unread marker).
- `video_files` is the replaceable storage layer: "delete everywhere" means processing every row of a video.
- Added after step 12 (additive): `battle_messages.event_json` (the chat documents proposals, answers, extra attempts, choices and votes).
- Added in step 12 (additive): `battles.ended_at`, `users.deletion_token_hash`.
- Added with the legal texts (additive, migration 0009): `users.terms_version`, `users.terms_accepted_at`.
- Added in stage 2 (additive): migration 0013 `competitions.level/description`; migration 0014 `push_subscriptions` (id, user_id, endpoint UNIQUE, created_at) and `notifications` (id, user_id, kind, battle_id, actor_id, created_at, delivered_at). Migration 0010: `reports` (id, reporter_id, target_type battle|video|user, target_id, category, text, status open|closed, created_at, closed_by, closed_at, close_note); migration 0011: `federation_approvals` (id, action, target_type, target_id, reason, payload_json, requested_by, status pending|approved|rejected|withdrawn, created_at, decided_by, decided_at, decision_note).
- Added in step 8 (additive): `videos.end_reason` (stopped / app left / camera lost) and `video_files.content_type`.
- Indexes follow the access patterns: open requests `battles(status, format_id, created_at)`, "my battles" `battle_participants(user_id)`, rankings `rating_states(format_id)`, replay `battles(format_id, event_at)`, clean-up jobs `videos(status)`.

### Later additions (additive only)

- **Stage 2:** `reports`, `review_assignments` (pool), `combo_configs`, `push_subscriptions`, `user_tags` (groups for over-rating detection).
- **Stage 3:** `tricks`, `trick_variations`, `video_tricks`, `video_quality_ratings`, `score_sheets`, `video_cut_points`, `polls`, `poll_options`, `poll_votes`. Multi-round formats already use `round`; back-and-forth formats are a part kind `response` plus different unlocking.

---

## 3. Rating computation

- `packages/rating` is pure: no database, network or clock. `rating/glicko_sim.py` stays the reference; `rating/export_fixtures.py` exports seeded reference histories that the TypeScript tests must reproduce.
- **Normal case (Worker):** when a battle is decided, the API loads the participants' `rating_states`, applies the single event with `RatingEngine` and writes states and history. This takes milliseconds.
- **Exceptions (GitHub Actions):** annulment, merging formats, a late initial estimate or a full recalculation with a new RuleSet create a `replay_request`. A scheduled job replays the history and writes the results back.
- Because the event timestamp is the time the result becomes final (spec §2.1), new events practically never arrive out of order. The engine refuses an out-of-order event instead of silently computing a wrong value.

---

## 4. Battle flow (implemented in step 5)

```
open ──accept──▶ active ─────────────▶ reviewing ─▶ decided
  │      └─(flexible)─▶ negotiating ─start / accepted settings─▶ active
  └─ retract / cancel ─▶ cancelled   (open, negotiating, active can end cancelled)
```

- **Request:** open for everyone or a direct challenge to one person. Settings default to
  `DEFAULT_BATTLE_SETTINGS` (`packages/shared/src/battles.ts`). Weight 4–5 is refused until the
  approval workflow exists (stage 2). The battle stores the format version and RuleSet version.
- **Acceptance:** fixed settings start the battle and set the deadline (time window counted from
  the start). Flexible settings lead to `negotiating`: the accepting side starts with the settings
  as they are, or proposes changes; an accepted settings proposal applies and starts the battle.
- **Proposals** (`battle_proposals`): settings, extension (new deadline) and cancel. They take
  effect when every other participant accepted. Rejecting a **cancel** proposal means the battle
  counts as a win for the rejecting side (concept §5.6), which updates the ratings immediately.
- **Goodwill:** a participant can grant the opponent an extra attempt at any time.
- **Missed deadline:** the side that delivered all videos chooses "count as my win" or "cancel
  unrated"; if nobody delivered, it can only be cancelled. If nobody decides within
  `AUTO_DECIDE_AFTER_DAYS` (7), an hourly cron trigger (`scheduled` in `src/index.ts`) does it.
- **Rating:** every decided battle runs `services/rating.ts` in the same database batch:
  states and history are written together with the result, or a replay request if the event
  would be out of order.

---

## 4b. Recording and upload (implemented in step 8)

```
Start pressed ──▶ attempt (id from the phone, IndexedDB) ──▶ POST /battles/:id/attempts (limit check)
Stop ──▶ cut + visibility ──▶ upload queue: POST /videos ─▶ PUT bytes ─▶ POST /videos/:id/complete
Choose the attempt that counts ──▶ POST /battles/:id/submissions ──▶ everyone chose ─▶ reviewing
```

- **Offline first:** a recording is stored chunk by chunk in IndexedDB (`apps/web/src/video/`);
  its id is the attempt id (UUIDv7). `uploadQueue.ts` registers attempts and uploads videos
  whenever the app is open and online (start, `online` event, app shown again, every minute).
  After a successful upload the local copy is deleted. The battle page and the few answers it needs
  are kept as offline copies in `localStorage` (`api.ts`), so a battle can be opened at the line.
- **Attempt limit:** `attemptsPerVideo` per part; goodwill extra attempts are one pool for the
  whole battle (`attemptsLeft` in `packages/shared/src/videos.ts`, used by phone and server).
  Attempts started before the deadline count even if they arrive later, while the battle runs.
- **Cut** without re-encoding before the upload (also makes the file seekable). If the phone
  cannot cut a file, it uploads the whole recording with the cut points (`trim_start_ms`,
  `trim_end_ms`) for the server to cut later.
- **Storage layer** (`apps/api/src/storage/videoStore.ts`): with an R2 access key, the phone
  uploads to a pre-signed R2 URL (valid 1 h) and plays from a pre-signed URL (6 h), so the bytes
  never touch the Worker. Without the key (local development, tests), the bytes go through the
  Worker (`PUT /videos/:id/upload`, `GET /videos/:id/file` with byte ranges), limited to 95 MB.
  `POST /videos/:id/complete` checks that the stored size matches. The hourly job removes files
  of uploads never completed after 2 days.
- **Choosing and unlocking:** the athlete picks one uploaded attempt per part; the choice can be
  changed until everyone has chosen. Then the battle moves to `reviewing` and the chosen videos
  unlock. Who may watch what is decided in one place, `canViewVideo` (`auth/permissions.ts`):
  the owner always; videos that count after unlocking for participants, and for other logged-in
  users unless *review only*; attempts that do not count stay private.
- **Cut-off recordings:** leaving the app ends the attempt. Such a video can be sent along with a
  request for an extra attempt (`extra_attempt` proposal with `change: 1` and `videoId`); the
  opponent may then watch it, and accepting grants the attempt.
- **Not yet:** deleting attempts that do not count after the battle, deleting *review only* videos
  after the review and public pages for *public* videos follow in step 12; the review in step 9.

---

## 4c. Review level 1 (implemented in step 9)

- `POST /battles/:id/vote` with a value −2 … +2 seen from seat 0 (`review_votes`, level 1). The
  vote can be changed while the battle is `reviewing`. Others' votes are hidden until both voted.
- Pure rules in `apps/api/src/battles/review.ts`: both on the same side → decided with
  s = mean of the two votes (1 / 0 for win/loss); otherwise open. After `REVIEW_DAYS` (7) the hourly
  job settles it: a single vote for one side decides, anything else ends the battle unrated
  (`cancel_reason = no_agreement`).
- Deciding runs `services/rating.ts` in the same batch (reason `review`). A conditional status
  change first makes sure two votes arriving at once cannot rate the battle twice.
- The battle response contains `review` and `ratingChanges` (from `rating_history`).

---

## 4d. On-site results (implemented in step 11)

- `POST /battles/onsite` creates a battle with `mode = onsite`, both participants and status
  `negotiating`, plus a `result` proposal (5-point value seen from the proposer, no draw).
  `playedAt` is the day of the battle; `deadlineAt` = now + `ONSITE_CONFIRM_DAYS` (14), after which
  the hourly job lets it expire like an unaccepted request.
- The other side accepts the proposal → decided (`decision_reason = onsite`, s from the value as in
  the review, rating update in the same batch, event time = confirmation). Rejecting leaves the
  battle open; both can enter a different `result`. `POST /battles/:id/withdraw-onsite` ends it
  unrated (`onsite_withdrawn`).
- Online-only actions (settings, extension, cancel, extra attempts, start) are refused for on-site
  battles, and `result` proposals for online battles.

---

## 4e. Clean-up, account deletion, replay (implemented in step 12)

- **Videos after a battle** (hourly job, `services/videos.ts`): `VIDEO_CLEANUP_DAYS` (7) after a
  battle ended (`battles.ended_at`, set when it is decided or cancelled), attempts that did not
  count (unless the owner keeps them) and *review only* videos are marked `deleted`. A second step
  removes the files of all deleted videos from R2 in batches (D1 allows 100 bound parameters per
  query, so batches stay at 90). Deleted videos are never served (`GET /videos/:id/file` → 404).
- **Visibility** is decided in one place, `canViewVideo`; *public* is treated like *logged in*
  until public pages exist.
- **Account deletion** (`POST /auth/delete-account`, password required, `services/accountDeletion.ts`):
  personal data removed (username `deleted-…`, display name "Deleted user", no e-mail, password,
  questionnaire), sessions/reset codes/login links deleted, roles revoked, chat messages deleted.
  Active battles and battles in review count as given up (win for the opponent); open requests,
  direct challenges, negotiations and unconfirmed on-site results are cancelled
  (`account_deleted`). Videos are kept by default; otherwise marked deleted. The answer contains a
  deletion link token (stored only as a hash, `users.deletion_token_hash`); with it,
  `POST /auth/deletion-request` deletes the kept videos later.
- **Replay** (`services/replay.ts`, `scripts/replay.ts`, `.github/workflows/replay.yml`): daily at
  03:23 UTC, only if a `replay_request` is open (out-of-order battle, admin request via
  `POST /rulesets/replay`), or forced by hand. It reads the raw data with `wrangler d1 execute`,
  runs `replay()` from `packages/rating` and replaces `rating_states` and `rating_history` in one
  SQL file. Battles decided while it ran trigger another replay request.

---

## 4f. Legal texts and terms acceptance

- Privacy policy, terms of use and legal notice are React pages in English and German
  (`apps/web/src/legal/`, routes `/privacy`, `/terms`, `/imprint`, public). The operator's name,
  address and e-mail live in one place, `apps/web/src/legal/operator.ts`. The texts describe what
  the app really does: a feature that processes new personal data (push notifications, public
  video pages, Telegram archive, Google login, e-mails) must update the privacy policy too.
- Sign-up requires `termsAccepted: true`; the account stores `TERMS_VERSION`
  (`packages/shared/src/auth.ts`) and the time. When `users.terms_version` differs from
  `TERMS_VERSION` (accounts from before, or after raising it), the app shows only a request to
  accept (`POST /auth/accept-terms`); the profile stays reachable so the person can delete the
  account instead. Raise `TERMS_VERSION` only for changes people must agree to.

---

## 4g. Roles, audit log, reports, annulment, estimates (stage 2, parts 2.1–2.4)

- **Roles:** `grantableRoles` (`packages/shared/src/roles.ts`) is the one rule: admins hand out
  judge, organizer, federation and admin; the federation hands out judge, organizer and
  federation. Nobody changes their own roles; the athlete role comes with the approval. Roles are
  read per request, so a change applies at once. `POST /api/users/:id/roles`, `…/roles/revoke`,
  `GET /api/users/staff`.
- **Audit log:** `GET /api/audit` for federation and admins, newest first, paged by id (`?before=`),
  filter `?targetType=&targetId=`. Shown on the admin page.
- **Reports** (`apps/api/src/routes/reports.ts`): approved users report a battle, a video or a
  profile (category + text). One open report per person and target, at most 10 open per person.
  Federation and admins list them (`GET /api/reports?status=open|closed`) and close them with a
  note (audited). The conflict-of-interest rule: whoever is concerned (the reported person, the
  participants of the battle, the owner of the video) cannot close it (`canHandle: false`). The
  reporter sees only whether it was handled (`GET /api/reports/mine`). The badge on the profile
  button counts open reports for federation and admins.
- **Annulment** (`apps/api/src/routes/annulment.ts`, part 2.3): `POST /api/battles/:id/annul`
  with a reason, only for decided battles and never by a participant. A federation member annuls
  at once: status `annulled`, `annulled_by/at`, `annul_reason`, a `replay_request` and an audit
  entry. The next replay drops the battle from every rating (it reads decided battles only); the
  battle page says so until then. An admin without the federation role creates a
  `federation_approvals` request instead (202), unless nobody holds the federation role yet; a
  federation member who is neither the requester nor a participant approves (the annulment is
  then carried out in the admin's name, `audit_log.federation_approval_by` = the approver) or
  rejects it; the admin can withdraw it. `GET /api/federation-approvals` lists the waiting
  requests (admin page). The table is generic so later sport-related admin actions can use it.
- **Initial estimates** (`apps/api/src/routes/estimates.ts`, part 2.4, rating spec §6.1):
  `POST /api/estimates` (subject, format, value 500–3000, `official`), only while the person has
  fewer than `MIN_BATTLES` battles in the (rating) format, never for oneself. A new estimate
  withdraws the estimator's previous one. `official` (federation → kind `federation`, admin →
  `admin`) overrides the athletes' median and is audited; athletes' estimates are not (they are
  not special permissions). The Worker applies estimates at a person's first battle; an estimate
  given or withdrawn after that adds a `replay_request` (the engine applies it retroactively).
  `GET /api/estimates?subjectId=` returns my own estimates and the count; federation and admins
  also see all of them with the estimators, except for themselves. The profile shows where the
  value would be in the current ranking.

---

## 4h. Review levels 2–3 (stage 2, parts 2.6–2.7)

Rules in `apps/api/src/battles/review.ts` (pure), flow in `apps/api/src/services/review.ts`,
routes in `apps/api/src/routes/reviews.ts`. `battles.review_level` (1–3) and
`battles.review_level_since` (migration 0012) say where a battle is.

- **Level 1 → 2:** when both athletes voted without agreement, either of them can hand the battle
  to the pool at once (`POST /battles/:id/escalate`); otherwise the hourly job does it when the
  level 1 review time (`REVIEW_DAYS`) is over. A single vote for one side still decides then;
  no vote ends the battle unrated.
- **Level 2 (pool):** `reviewerRole` decides who may review: an athlete who is not taking part,
  has at least `poolMinBattles` battles in the battle's rating format and whose rating lies in
  `poolWindow` around R_high (the higher participant rating): ±150 at first, up to +250 after
  48 h, from −250 without upper limit after 7 days. One review per person, blind and final
  (`POST /battles/:id/pool-vote`). With `poolSize` (3) reviews, `poolOutcome`: no contradiction →
  decided, s = mean of the reviews ("can't decide" = 0.5); reviews for both sides or only "can't
  decide" → level 3. A pool that is not full after `poolMaxDays` (14) goes to level 3 as well.
- **Level 3 (judge):** any active judge who is not taking part decides with one vote −2/−1/+1/+2
  (`POST /battles/:id/judge-decision`, optional note), audited as `review.judge_decision`. Judges
  see the earlier votes (athletes and pool).
- **Reviewers watch the videos:** `canViewVideo` lets the pool and the judge see "review only"
  videos while they review.
- **"To review":** `GET /reviews/open` lists the battles waiting for the viewer (pool or judge),
  shown at the top of the start page with a dot on the Battles tab.
- The window values are RuleSet parameters (`params.review`, defaults `REVIEW_DEFAULTS` in
  `packages/shared/src/rulesets.ts`), so a new RuleSet version can change them.

---

## 4i. On-site group battles (stage 2, part 2.8)

- `POST /battles/onsite-group` (`apps/api/src/routes/groups.ts`): format, date, weight 1–3 and
  everyone's placement (3–20 people including the person entering it; 1 = best, equal places
  allowed, not all on one place). The battle has `kind = group`, `mode = onsite`,
  `scoring = placement`, status `negotiating`, seats in the order entered (seat 0 = the person
  entering it), and expires after `ONSITE_CONFIRM_DAYS` like an on-site single battle.
- The result is a `result` proposal `{ placements }`; the person entering it has accepted it
  (`proposal_responses`). Others confirm (`/group-confirm`) or reject (`/group-reject`, the
  battle stays open); anyone taking part can enter a corrected result (`/group-result`, replaces
  the pending one). "Did not take place" is `/withdraw-onsite` as for single battles. The generic
  proposal routes refuse group battles.
- It counts when every participant confirmed – or when one judge, organizer or federation member
  who does not take part confirms it for everyone (`/official-confirm`, audited as
  `battle.official_confirm`; owner, 2026-10-12).
- Rating: `battle_participants.placement` is stored; `toRatingEvent` (`services/rating.ts`) and
  the replay build a `placement` event, which the engine splits into all pairs weighted
  1/(n−1) (rating spec §5.1). It counts as one battle per person.

---

## 4j. Official competitions (stage 2, parts 2.5 and 2.9)

`apps/api/src/routes/competitions.ts`; `competitions.level` and `competitions.description`
(migration 0013).

- An organizer or the federation creates a competition with name, place, date and a weight
  1–5 for all its battles (owner, 2026-10-12: levels 1 and 2 too; weight 4–5 exists only here).
- The organizer enters results while the status is `planned`: single battles (A vs B, 5-point
  value or win/loss) and final placements per format (one per format; a new one replaces it).
  Each result is a battle with `competition_id`, `mode = onsite`, the competition's level and
  its score/placement stored – but `negotiating`, so it does not count. Results can be removed
  (`cancel_reason = removed`). `submit` → status `finished` (waiting for confirmation),
  `reopen` → back to `planned`, `cancel` → all results cancelled.
- A judge or the federation who neither organized it nor took part confirms (`confirm`,
  audited): every result is decided (`decision_reason = competition`) and rated at the
  confirmation time, one millisecond apart; `level_approved_by/at` is set (rating spec §4: levels
  4–5 count from their approval). In a format with single battles its final placement is
  cancelled (`superseded_by_battles`, spec §5.2).
- Pages `/competitions` and `/competitions/:id`; battle pages link to their competition.

---

## 4k. Combined rankings (stage 2, part 2.11)

- Pure functions in `packages/rating/src/ranking.ts` (rating spec §8.2): `formatNormalization`
  (mean and spread of R = r − 2·RD over the non-provisional people; below `comboMinPop` the
  fallback spread `comboFallbackSd` around the mean of everyone), `combineZ` (missing format =
  `comboMissingZ`, the X worst dropped, at least one value kept) and `combinedRanking`. Tested
  against the worked example of §8.2.
- `GET /api/rankings/combined` (`apps/api/src/routes/rankings.ts`): without a query the official
  ranking – all *relevant* formats (or `params.officialCombo.formatIds`), the
  `params.officialCombo.dropWorst` worst dropped, 1 by default (owner, 2026-10-12). The
  federation changes it with a new RuleSet version (rules are data). `?formats=a,b&drop=n` is a
  free combination (not stored).
- Rankings page: "One format / Combined"; the combined view shows the official configuration,
  lets everyone choose formats and how many to drop, and shows the z-value per format.

---

## 4l. Push notifications (stage 2, part 2.13)

- Events (owner, 2026-10-12): opponent accepted, videos unlocked, review needed (pool members in
  range and judges, at most 30 each), chat message (at most one per battle and person per 15
  minutes) – not new challenges. `services/notify.ts` writes a `notifications` row per person
  (migration 0014) and, if the person registered a device, sends a push.
- The push is **empty** (`services/push.ts`: VAPID JWT signed with WebCrypto, no payload): no
  payload encryption, little CPU, no content at Google/Apple/Mozilla. The service worker
  (`apps/web/public/push-sw.js`, loaded via `workbox.importScripts`) fetches
  `GET /api/notifications/pending` (marks them delivered) and shows them; if that fails it shows
  a general notification (iOS requires one per push).
- Devices: `push_subscriptions` (endpoint only). `GET /api/push/key`, `POST /api/push/subscribe`,
  `POST /api/push/unsubscribe`; 404/410 from the push service removes the subscription. Logout
  and account deletion remove them; notifications are deleted after 30 days (hourly job).
- Secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`docs/deployment.md`); without
  them nothing is pushed. Profile → Notifications turns it on per device (iPhone: installed app).
- Settings (owner, session 6): each kind can be turned off per account (`users.notify_off_json`,
  migration 0015; `GET/PUT /api/push/settings`); turned-off kinds get no row and no push.
- Diagnosis (session 6): "Send a test" (`POST /api/push/test`) pushes to this device and shows
  the push service's answer (`sent` = the phone's settings block it). Failed pushes are logged
  (Cloudflare observability). Pushes use `Urgency: high` (Android delays `normal` while the phone
  sleeps); the app re-registers its subscription at every start; repeated notifications of one
  battle alert again (`renotify`).
- App icon number (`apps/web/src/badge.ts`, Badging API): battles that wait for me or have
  unread messages plus open reviews, set while the app runs; the service worker adds new
  notifications to it. Works where the platform allows it: installed app on iPhone (only with
  notifications allowed) and on computers. Android has no Badging API: its launcher shows a
  dot/number for the app's notifications, so there the number needs notifications on.

---

## 5. Implementation order (stage 1)

| # | Step | Status |
|---|---|---|
| 0 | Repository setup: pnpm workspace, strict TypeScript, Biome, Vitest, CI | done |
| 1 | `packages/rating`: Glicko-2 core, inactivity, protection rule, scores, events (single/group/placement), estimates, merged formats, replay, format ranking; tests against spec §11 and the Python reference | done |
| 2 | D1 schema (migrations 0000 + 0001), Worker skeleton with Hono, local development, seed data (RuleSet v1, launch formats) | done |
| 3 | Login: sign-up with age confirmation, sessions, approval, admin bootstrap, audit log, password reset codes | done (Google login postponed, see §1) |
| 4 | Formats and RuleSets (admin) | done |
| 5 | Battle lifecycle API: request, accept, settings, proposals, cancellation, deadlines | done |
| 6 | Web app skeleton: PWA shell, login, battle lists, request/accept | done (plus deployment, `docs/deployment.md`) |
| 6b | Feedback round 1: password minimum 8, free attempts/time window, Lichess-like format tiles, format proposals, extra attempt confirmation and take-back, profiles, format rankings (step 10 pulled forward), chat | done |
| 7 | Video prototype: recording, attempt limit, quality levels, trimming without re-encoding (real phones) | test page built (`/lab/video`, `docs/video-prototype.md`); waiting for results from real phones |
| 8 | Offline storage (IndexedDB), upload queue, signed R2 uploads, choosing the attempt that counts, unlocking | done (§4b); waiting for real-phone tests |
| 9 | Review level 1, result → rating update in the Worker, rating history | done (§4c) |
| 10 | Format rankings | done (pulled forward, with profiles) |
| 11 | On-site results with confirmation by both sides | done (§4d) |
| 12 | Replay job, deployment pipeline, enforcing visibility, account deletion | done (§4e) |
| – | Legal texts (privacy policy, terms of use, legal notice) and terms acceptance | done (§4f); operator data to be filled in, short check by someone qualified recommended |

The video prototype (step 7) is the biggest technical risk (trimming without re-encoding in the browser) and can be started early in a separate session (concept §16).
