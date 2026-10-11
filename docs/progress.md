# Progress and handover

Read this at the start of every session; update it at the end (see `CLAUDE.md`).

Last updated: 2026-10-11 (end of the second session: video prototype).

---

## 1. Current state

**Live app:** <https://highline-freestyle-battles.highlinefreestyle.workers.dev> (Cloudflare Workers
free tier, D1 database in Western Europe). Every merge into `main` is published automatically by
`.github/workflows/deploy.yml` (setup: `docs/deployment.md`).

**Branch / PRs:** session 1 = PRs #1–#4 (branch `claude/nice-sagan-akpprj`). Session 2 = the video
prototype on branch `claude/wonderful-ramanujan-50o2jk` (see its PR). A new session can start a
fresh branch from `main`.

**Tests:** 41 rating engine tests, 22 video cutting tests (`apps/web/test`) and 80 API tests (Workers runtime + local D1), lint, typecheck and
build all pass in CI. Browser flows were checked by hand with Playwright/Chromium against a local
Worker (script not committed yet, see next steps).

### Done (development stage 1)

| Step (`docs/architecture.md` §5) | What exists |
|---|---|
| 0 Setup | pnpm workspace, strict TypeScript, Biome, Vitest, CI, deploy workflow |
| 1 Rating engine | `packages/rating`: weighted Glicko-2, inactivity, protection rule, groups/placements, estimates, merged formats, replay, ranking; matches `rating/glicko_sim.py` to 1e-6 |
| 2 Database + Worker | D1 schema `apps/api/src/db/schema.ts`, migrations `0000`–`0005`, Hono API |
| 3 Login | sign-up with age confirmation, approval (invitation tree), first admin via `SETUP_TOKEN`, PBKDF2 + pepper, sessions, reset codes, audit log |
| 4 Formats + RuleSets | admin management, versions, format proposals by athletes with approval |
| 5 Battle flow | requests, direct challenges, fixed/negotiable rules, proposals, goodwill attempt (+ take-back), give up, deadlines, hourly job for expired/abandoned battles, rating update on decided battles |
| 6 Web app | React PWA: all of the above, Lichess-like format tiles, profiles, rankings, chat |
| 10 Rankings | pulled forward: format ranking (r − 2·RD) and profiles |
| 7 Video prototype (part 1) | test page `/lab/video` without login: recording, attempt counter, quality levels, IndexedDB chunks with crash recovery, cutting without re-encoding (own MP4/WebM code), test report. Guide and findings: `docs/video-prototype.md` |

### Not started yet

Step 7 is waiting for results from real phones. Steps 8 (offline storage, R2 upload, unlocking), 9 (review level 1 → result →
rating), 11 (on-site results), 12 (replay job, account deletion, visibility enforcement).
**Right now ratings only change through a forfeit or a missed deadline**, because the review
after uploading videos does not exist yet.

---

## 2. Decisions made in this session

| Decision | Why |
|---|---|
| React + Vite static SPA, Hono API, Drizzle, pnpm workspaces, Biome | Widest contributor reach; static files cost no Worker requests; simple tooling |
| One Cloudflare Worker serves app + API (instead of Pages + Worker) | Same origin: login cookies work in Safari (`*.pages.dev`/`*.workers.dev` are public suffixes); asset requests are free |
| Own small session login instead of Better Auth | E-mail must stay optional; approval, invitation tree and admin reset are custom anyway |
| Passwords: PBKDF2-SHA256 (50,000 iterations) over an HMAC pepper (Cloudflare secret); minimum 8 characters; lockout 15 min after 5 failures | A stolen database alone is useless; 100,000 iterations exceeded the free-tier CPU limit in a measurement; iterations are stored per hash and upgraded at login |
| First admin via one-time `SETUP_TOKEN` | Nobody exists yet who could approve the first account |
| Password reset only via one-time codes from admin/federation | No e-mail reset (e-mail is optional) |
| Rating spec v1.1: event time = time the result becomes final; levels 4–5 rated at approval time; group battle = 1 battle for `MIN_BATTLES`; late initial estimates apply retroactively | Fewer replays (owner's wish); consistent with "a group battle weighs like one battle" |
| Best of N: all attempts uploaded, athlete chooses the one that counts before unlocking; others deleted by default unless kept | Owner's decision; storage and privacy friendly default |
| Battle = rating event in the schema; enum CHECKs contain later-stage values; only additive migrations | Stages 2/3 without table rebuilds |
| Direct challenges in addition to open requests | Requested; only the challenged person can accept |
| Deadline is a fixed date + time (default: 7 days, 05:00 German time), not a duration | Waiting for an opponent must not extend the battle; 05:00 Europe/Berlin leaves the Americas the whole previous day |
| Missed deadline: the delivering side decides (win / unrated); automatic decision after 7 days | Battles must not stay open forever |
| Fixed vs negotiable rules shown; binding steps need a confirmation | Clear when accepting becomes binding and can cost rating points |
| Format proposals by every athlete, approved as official (tile) or other ("more formats") | Owner's wish; pulled forward from stage 3 |
| Format parts: Tricks (count; transition bounces allowed; best trick = 1 trick), Bounces (every bounce counts), Other (free text) | Tricks and bounces are judged differently; "Other" keeps creativity open |
| Chat per battle, only participants, polled every 20 s while visible | Requested; push notifications come with stage 2 |
| Profiles and rankings visible to logged-in users only | Privacy |
| Free attempts (1–99 or unlimited) | Requested |
| Claude may merge its own PRs once CI is green | Owner's decision, for faster iterations |
| Level 1: s = mean of both mirrored assessments (only when both agree on the side) | Owner left it to Claude (session 2); simple and uses the margin information of both |
| Video test page public at `/lab/video`, no login | Owner's decision: testers (friends with iPhones) need no account |
| Cut at the keyframe before the chosen start; if cutting fails on a platform, upload uncut + cut times and cut on the server | Owner agreed (session 2) |
| Own small MP4/WebM cutting code instead of ffmpeg.wasm/mp4box.js | ffmpeg.wasm is ~30 MB and slow on phones; copying samples needs only a few hundred lines |
| App reloads itself once a new version's service worker has taken over | Otherwise the first visit after a deploy runs the cached old app (`/lab/video` showed "404 Not Found") |
| Leaving the app ends the attempt; a cut-off video can be sent to the opponent with a request for an extra attempt | Owner's decision after the Android test: the camera freezes in the background, and pause/resume would allow hiding a fall |
| Full-screen camera with one record button (portrait: controls at the bottom, landscape: on the right) | Owner's feedback: in landscape the Start button was hard to reach |
| Ask MediaRecorder for a keyframe every second | Chrome otherwise writes one keyframe per recording (no cutting, no crash recovery) |

---

## 3. Open questions for the project owner

1. Video test results from iPhones (friends of the owner; guide in `docs/video-prototype.md` §1).
   Android still to check: HD, crash test (close the browser while recording).
2. Auto-cut (`docs/auto-cut.md`): 10–20 real test videos with roughly marked bounce bottoms are
   needed before prototyping it.
3. Optional housekeeping: mark the GitGuardian finding on PR #1 (`PASSWORD_ITERATIONS = 50_000`)
   as a false positive in the GitGuardian dashboard.
4. Google login is postponed: it needs a Google Cloud OAuth client created by the owner. Still wanted?
5. Further open questions of the concept are listed in `docs/concept.md` §15.

---

## 4. Next steps

1. **Evaluate the iPhone test reports (step 7)**; Android (Chrome) is tested and works
   (`docs/video-prototype.md` §3). Then decide format strategy, keyframe interval and bit rates.
2. **Upload and unlocking (step 8):** signed R2 uploads (needs R2 enabled on the Cloudflare
   account, which requires a payment method but stays free within 10 GB), upload queue, choosing
   the attempt that counts, unlocking when both have submitted.
3. **Review level 1 and rating (step 9):** 5-point votes by both athletes, result → existing
   `services/rating.ts`.
4. **Commit the browser test** (Playwright against a local Worker) so UI flows are checked in CI.
5. Measure PBKDF2 CPU time on Cloudflare and raise `PASSWORD_ITERATIONS` if there is headroom.

Then: on-site results (step 11), replay job and account deletion (step 12), stage 2.
