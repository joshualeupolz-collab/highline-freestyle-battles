# Progress and handover

Read this at the start of every session; update it at the end (see `CLAUDE.md`).

Last updated: 2026-10-11 (third session: steps 8 and 9, upload, unlocking, review level 1).

---

## 1. Current state

**Live app:** <https://highline-freestyle-battles.highlinefreestyle.workers.dev> (Cloudflare Workers
free tier, D1 database in Western Europe). Every merge into `main` is published automatically by
`.github/workflows/deploy.yml` (setup: `docs/deployment.md`).

**Branch / PRs:** session 1 = PRs #1–#4 (branch `claude/nice-sagan-akpprj`). Session 2 = the video
prototype on branch `claude/wonderful-ramanujan-50o2jk` (PRs #5–#8). Session 3 = step 8 on branch
`claude/serene-cori-tl2ap4` (PR #10 step 8, then step 9). A new session can start a fresh branch from `main`.

**Tests:** 41 rating engine tests, 22 video cutting tests (`apps/web/test`) and 105 API tests
(Workers runtime + local D1 + local R2), lint, typecheck and build all pass in CI. The step 8 flow
was checked with Playwright/Chromium (fake camera) against a local Worker: two athletes record,
one of them offline; the upload starts by itself when back online; choosing unlocks both videos,
which play for the opponent; both vote and the ratings change (script not committed yet, see next steps).
Steps 8 and 9 were also tested by the owner on Android phones with direct R2 uploads: work.
Step 11 was checked the same way in Chromium (enter, confirm, rating change).

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
| 11 On-site results | enter format, opponent, date, weight, scoring and result; the opponent confirms, rejects or enters a different result; withdraw; expires after 14 days; rating on confirmation. Details: `docs/architecture.md` §4d |
| 9 Review level 1 | 5-point vote by both athletes, hidden until both voted, changeable; agreement decides and updates the ratings (s = mean of both votes); after 7 days a single vote for one side decides, otherwise unrated; result shows the rating change. Details: `docs/architecture.md` §4c |
| 8 Upload and unlocking | recording on the battle page (attempt registered at Start, limit checked on phone and server), offline storage + upload queue, cut before upload, visibility/keep per video, R2 storage layer (signed URLs, or through the Worker without access key), choosing the attempt that counts, unlocking when everyone chose (`reviewing`), cut-off video with extra-attempt request, offline copies of battle data. Details: `docs/architecture.md` §4b |

### Not started yet

Step 12 (replay job, account deletion, deleting videos after the battle, visibility enforcement
for public pages). iPhone tests of step 7 are still open.
**UI overhaul:** the owner finds the interface still somewhat confusing; to be reworked at the
end of stage 1 (owner's wish), e.g. a clear "what to do next" per battle.

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
| Step 8: signed R2 URLs when an R2 access key exists, otherwise uploads through the Worker (≤ 95 MB) | Documented decision (bytes never touch the Worker); the fallback makes local development and the time before the key is set up work |
| Step 8: bucket `hfb-videos` and its CORS rules are created by the deploy workflow | One manual step less for the owner; needs R2 permission on the deploy token |
| Step 8 defaults (owner to confirm): extra attempts are one pool for all parts; the choice can be changed until everyone chose; attempts started before the deadline count when uploaded later; *public* videos are visible to logged-in users until public pages exist | Simple, fair defaults; see `docs/concept.md` section 6 |
| `newId` (UUIDv7) moved to `@hfb/shared` | The phone creates attempt ids too |
| Step 11 defaults (owner to confirm): no draw on site; confirmation within 14 days; date up to 60 days back; rejecting keeps the battle open for another result; either side can withdraw | Same 5-point scale and no-draw rule as the online review |
| Step 9 (owner): on disagreement both may change their vote; no draw in stage 1; after 7 days a single vote for one side decides, otherwise unrated | Level 2 (pool) does not exist yet; whoever takes part is not punished |

---

## 3. Open questions for the project owner

0. **R2 setup (step 8):** check that the deploy step *Video bucket and its CORS rules* passes (if
   not: add *Workers R2 Storage → Edit* to the Cloudflare API token), then create the R2 access
   key and the GitHub secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
   (`docs/deployment.md`, "Videos") – done, R2 direct uploads work. Still to confirm: the step 8
   defaults in section 2.
1. Video test results from iPhones (friends of the owner; guide in `docs/video-prototype.md` §1).
   Android (Chrome) is fully tested (`docs/video-prototype.md` §3).
2. Auto-cut (`docs/auto-cut.md`): 10–20 real test videos with roughly marked bounce bottoms are
   needed before prototyping it.
3. Optional housekeeping: mark the GitGuardian finding on PR #1 (`PASSWORD_ITERATIONS = 50_000`)
   as a false positive in the GitGuardian dashboard.
4. Google login is postponed: it needs a Google Cloud OAuth client created by the owner. Still wanted?
5. Further open questions of the concept are listed in `docs/concept.md` §15.

---

## 4. Next steps

1. **Test step 8 on real phones** (a real battle between two people, one recording without
   connection at the line). Also the iPhone reports of step 7 (`docs/video-prototype.md` §1).
2. **Step 12:** replay job (GitHub Actions), account deletion, deleting videos after the battle,
   visibility enforcement. Afterwards the UI overhaul.
3. **Commit the browser test** (Playwright against a local Worker) so UI flows are checked in CI.
4. Later in step 12: delete attempts that do not count after the battle (unless kept), *review only*
   videos after the review; multipart upload if large HD uploads fail on mobile connections.
5. Measure PBKDF2 CPU time on Cloudflare and raise `PASSWORD_ITERATIONS` if there is headroom.

Then: on-site results (step 11), replay job and account deletion (step 12), stage 2.
