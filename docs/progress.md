# Progress and handover

Read this at the start of every session; update it at the end (see `CLAUDE.md`).

Last updated: 2026-10-12 (end of the sixth session: push fixes, notification settings, app icon number, filming by friends with the athlete code, owner's feedback round).

---

## 1. Current state

**Live app:** <https://highline-freestyle-battles.highlinefreestyle.workers.dev> (Cloudflare Workers
free tier, D1 database in Western Europe). Every merge into `main` is published automatically by
`.github/workflows/deploy.yml` (setup: `docs/deployment.md`).

**Branch / PRs:** session 1 = PRs #1–#4 (branch `claude/nice-sagan-akpprj`). Session 2 = the video
prototype on branch `claude/wonderful-ramanujan-50o2jk` (PRs #5–#8). Session 3 = branch
`claude/serene-cori-tl2ap4`: PRs #10 (step 8), #11 (step 9), #12 (step 11), #13 (step 12),
#14 and #15 (UI rounds 1 and 2), all merged and deployed. Session 4 = branch
`claude/gallant-ritchie-r1n4tv`: legal texts. Session 5 = branch
`claude/bold-planck-lrea7q`: PRs #18 (browser tests), #19 (stage 2 plan, roles, audit log),
#20 (iPhone results), #21 (reports, annulment, estimates, review levels 2–3), #22 (on-site group
battles), #23 (competitions), #24 (combined rankings), #25 (push notifications) merged.
Session 6 = branch `claude/exciting-feynman-hd7dtr`: PRs #26 (push fixes, settings, app icon
number), #27 (athlete code) merged; then the owner's feedback round (next PR). **The owner allows Claude to merge its
own PRs once CI is green** (session 6); if the session's safety check blocks it, Claude says
so and the owner merges. A new session starts a fresh branch from `main`.

**Tests:** 22 video cutting tests (`apps/web/test`), 148 API tests, 44 rating tests
(Workers runtime + local D1 + local R2), lint, typecheck and build all pass in CI. The step 8 flow
was checked with Playwright/Chromium (fake camera) against a local Worker: two athletes record,
one of them offline; the upload starts by itself when back online; choosing unlocks both videos,
which play for the opponent; both vote and the ratings change. These flows are now committed as
browser tests (`e2e/`, `pnpm e2e`, CI job `e2e`; video battle, on-site result, sign-up + approval,
reports, initial estimates, handing a dispute to the pool, on-site group battle, competition, combined ranking).
Steps 8 and 9 were also tested by the owner on Android phones with direct R2 uploads: work.
Step 11 was checked the same way in Chromium (enter, confirm, rating change).

### Done (development stage 1)

| Step (`docs/architecture.md` §5) | What exists |
|---|---|
| 0 Setup | pnpm workspace, strict TypeScript, Biome, Vitest, CI, deploy workflow |
| 1 Rating engine | `packages/rating`: weighted Glicko-2, inactivity, protection rule, groups/placements, estimates, merged formats, replay, ranking; matches `rating/glicko_sim.py` to 1e-6 |
| 2 Database + Worker | D1 schema `apps/api/src/db/schema.ts`, migrations `0000`–`0008`, Hono API |
| 3 Login | sign-up with age confirmation, approval (invitation tree), first admin via `SETUP_TOKEN`, PBKDF2 + pepper, sessions, reset codes, audit log |
| 4 Formats + RuleSets | admin management, versions, format proposals by athletes with approval |
| 5 Battle flow | requests, direct challenges, fixed/negotiable rules, proposals, goodwill attempt (+ take-back), give up, deadlines, hourly job for expired/abandoned battles, rating update on decided battles |
| 6 Web app | React PWA: all of the above, Lichess-like format tiles, profiles, rankings, chat |
| 10 Rankings | pulled forward: format ranking (r − 2·RD) and profiles |
| 7 Video prototype (part 1) | test page `/lab/video` without login: recording, attempt counter, quality levels, IndexedDB chunks with crash recovery, cutting without re-encoding (own MP4/WebM code), test report. Guide and findings: `docs/video-prototype.md` |
| 12 Clean-up, deletion, replay | hourly job deletes unneeded videos 7 days after a battle (from R2 too); account deletion with "keep videos" (default) and deletion link; replay as GitHub Action (daily if requested, or by hand) plus admin request button. Details: `docs/architecture.md` §4e |
| 11 On-site results | enter format, opponent, date, weight, scoring and result; the opponent confirms, rejects or enters a different result; withdraw; expires after 14 days; rating on confirmation. Details: `docs/architecture.md` §4d |
| 9 Review level 1 | 5-point vote by both athletes, hidden until both voted, changeable; agreement decides and updates the ratings (s = mean of both votes); after 7 days a single vote for one side decides, otherwise unrated; result shows the rating change. Details: `docs/architecture.md` §4c |
| Legal texts (session 4) | privacy policy, terms of use and legal notice in English and German (`/privacy`, `/terms`, `/imprint`, `apps/web/src/legal/`); sign-up requires accepting the terms (version stored, migration 0009); existing accounts accept once in the app; links on login/sign-up and in the profile. Details: `docs/architecture.md` §4f |
| 8 Upload and unlocking | recording on the battle page (attempt registered at Start, limit checked on phone and server), offline storage + upload queue, cut before upload, visibility/keep per video, R2 storage layer (signed URLs, or through the Worker without access key), choosing the attempt that counts, unlocking when everyone chose (`reviewing`), cut-off video with extra-attempt request, offline copies of battle data. Details: `docs/architecture.md` §4b |

### Done (development stage 2, session 5)

Everything of `docs/stage-2-plan.md` except 2.12 (over-rating warning, needs data; 2.10
athlete code followed in session 6): roles + audit log, reports, annulment with federation approval, initial estimates,
review levels 2–3 (pool + judge), on-site group battles, competitions with weight 1–5, combined
rankings, push notifications. Details: `docs/architecture.md` §4g–§4l.

### Session 6 (branch `claude/exciting-feynman-hd7dtr`)

Owner reported: push can be turned on on Android, but no notification arrives for chat
messages. Checked: the VAPID secrets are deployed; Google's push service accepts our VAPID
signature (403 only for a broken token); the Worker sends the request correctly; the service
worker fetches and shows the texts (Chromium, push delivered via DevTools). No bug found that
explains it, so: `Urgency: high` (Android holds back `normal` pushes while the phone sleeps),
re-registering the subscription at every app start, `renotify` for repeated battle
notifications, logging of refused pushes, and a **"Send a test" button** in the profile that
shows what the push service answered. Also new: **notification settings** per kind (migration
0015) and the **number on the app icon** (Badging API; Android only via notifications, iPhone
only with notifications allowed). Details: `docs/architecture.md` §4l.
**Owner to test:** Profile → Notifications → "Send a test". "Sent" but nothing appears = the
phone blocks it (Android settings → Apps → the app / Chrome → Notifications; battery saving).
PR #26 (push) merged by Claude with the owner's permission ("Claude may merge once CI is
green" applies again). Also: API test timeout raised to 20 s (CI runner was too slow for tests
that register many people).

**Filming by friends (2.10) done:** athlete code in the profile (share link), public page
`/film` for the friend, "filmed by …" labels, video settings for friends' videos, privacy
policy updated (EN/DE). PR #27 merged. Details: `docs/architecture.md` §4m. Tests:
`apps/api/test/friendVideos.test.ts`, browser test `e2e/tests/film-for-friend.spec.ts`.

**Owner's feedback after testing (same session):** push works (also on the iPhone); on Android
tapping a notification did not open the app → fixed (`push-sw.js` focuses first, then
navigates, otherwise the app switches pages itself or a window is opened). The athlete chooses
the code freely (migration 0017, `athlete_code_key`). Filming by friends is **online only**:
offline description, inbox and confirmation removed again. Running battles are loaded in the
background so one's own battles can be opened and recorded offline (checked in Chromium with
the service worker: app opened offline → battle never opened before → record → upload after
reconnecting).

**Open (owner to decide): cheating with offline recordings.** Today an attempt recorded offline
only reaches the server when the phone is online again; deleting the app (or its data) before
that hides a bad attempt. Claude's proposal: *reserve attempts while online* – see open
question 6.

### Not started yet

All stage 1 features exist. iPhone tests of step 7 passed on two iPhones (Safari and Brave: H.264 MP4,
keyframe every second, cutting works, HD 43.8 MB/min; `docs/video-prototype.md` §3), and real
battles work on the iPhone. The installed app (home screen) gets persistent storage, the browser does not. Public pages for *public*
videos come later (until then they are visible to logged-in users).
**UI overhaul (first round, done):** tab bar at the bottom (Battles, Requests, New, Rankings)
with a dot when something waits for you, profile button top right (approvals, admin, format
proposals there); every battle shows its next step (`apps/web/src/nextStep.ts`) in the list and
at the top of the battle page; rare actions under "More options"; compact settings line;
rating "?" (tap for an explanation). The app stays English only (owner, 2026-10-11).
**UI round 2 (owner's feedback):** camera zoom with two fingers (camera's own zoom where the
browser offers it, otherwise the page cannot be zoomed on the camera screen), quality choice
(480p/720p/1080p + info) inside the camera, finished battles tinted green/red with the rating
change, format color in list and battle head, settings as chips, weights with their factor
from the RuleSet, "Settings negotiable", direct challenge folded at the end, deadline fields
hidden with "no deadline", chat documents proposals/answers/extra attempts/choices/votes
(`battle_messages.event_json`, migration 0008; not counted as unread), red badge on the
profile button for members waiting for approval, confirmation before approving.

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
| UI: tab bar at the bottom, "next step" per battle, rare actions folded away; English only (owner) | The owner found the interface confusing; thumb reach on phones |
| Step 12 (owner): deleting an account counts running battles as given up; keeping videos is preselected; unneeded videos are deleted 7 days after the battle | Deleting must not avoid a loss; videos are valuable for the community |
| Step 11 defaults (confirmed by the owner): no draw on site; confirmation within 14 days; date up to 60 days back; rejecting keeps the battle open for another result; either side can withdraw | Same 5-point scale and no-draw rule as the online review |
| Legal texts: operator = the owner as a private person with home address; EN + DE, German version of the terms prevails; checkbox at sign-up and one-time acceptance for existing accounts (owner, session 4) | Needed before inviting beta testers; DE is usual for an operator in Germany |
| Operator stays the owner for now; a later move to the international federation (Switzerland) is kept possible (concept §12) | GDPR applies anyway (users in the EU), so the move is about responsibility and an official operator, not less data protection |
| Fixed: the camera's `.segmented` style applied to every segmented control (format part types looked like the camera bar) | Found while styling the language switch |
| Step 9 (owner): on disagreement both may change their vote; no draw in stage 1; after 7 days a single vote for one side decides, otherwise unrated | Level 2 (pool) does not exist yet; whoever takes part is not punished |

---

## 3. Open questions for the project owner

00. **Legal texts:** operator data is filled in (`apps/web/src/legal/operator.ts`); the contact
    e-mail is still the owner's private address – replace it with a separate address for the app
    when it exists. A short check of the texts by someone qualified is recommended (Claude is not
    a lawyer). If the texts change in a way people must agree to, raise `TERMS_VERSION` in
    `packages/shared/src/auth.ts`.
0. **R2 setup (step 8):** check that the deploy step *Video bucket and its CORS rules* passes (if
   not: add *Workers R2 Storage → Edit* to the Cloudflare API token), then create the R2 access
   key and the GitHub secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
   (`docs/deployment.md`, "Videos") – done, R2 direct uploads work.
   Not yet tried on the real database: the rating replay (*Actions → Rating replay → Run workflow*
   with "force" is a safe first test – it should reproduce the current ratings).
1. Video test results from iPhones (friends of the owner; guide in `docs/video-prototype.md` §1).
   Android (Chrome) is fully tested (`docs/video-prototype.md` §3).
2. Auto-cut (`docs/auto-cut.md`): 10–20 real test videos with roughly marked bounce bottoms are
   needed before prototyping it.
3. Optional housekeeping: mark the GitGuardian finding on PR #1 (`PASSWORD_ITERATIONS = 50_000`)
   as a false positive in the GitGuardian dashboard.
4. Google login is postponed: it needs a Google Cloud OAuth client created by the owner. Still wanted?
5. Further open questions of the concept are listed in `docs/concept.md` §15.
6. **Offline recording without cheating** (proposal, session 6): before going offline the app
   *reserves* attempts for a battle while online ("Prepare for offline", or automatically when
   a battle page is opened). Reserved attempts count as used at once; recording offline uses a
   reserved attempt; when the phone is online again it hands back the ones it did not use.
   Deleting the app loses the reservations – they stay used – so hiding a bad attempt gains
   nothing. Without a reservation, recording needs a connection (Start is registered at once).
   Remaining gap: the phone's clock (deadline) – reservations are only possible before the
   deadline, and their attempts must have started before it. Effort: about one session
   (attempt reservations table, release endpoint, phone-side store, UI). Waiting for the
   owner's decision. The owner asked whether the app can send something when it is closed or
   uninstalled: not reliably – `pagehide` + `sendBeacon` only works with a connection,
   uninstalling a PWA (or clearing its data) fires no event at all, and Background Sync is
   Chrome-only and is deleted together with the app. Only signal: pushes to a removed device
   get 404/410 later, but only if push was on, delayed and not on every platform. So the
   reservation stays the robust solution.

---

## 4. Next steps

1. **More UI feedback** from the owner (announced for the next session).
2. **Legal texts:** done except the operator data (open question 00). Keep the privacy policy in
   line with new features (push, public video pages, Telegram archive, Google login, e-mails).
3. **Stage 2, rest:** 2.12 over-rating warning later (needs ≥ 10 battles per estimated
   person). Online group battles later. Athlete-code defaults decided (owner): friends' videos
   start as *public*; the code stays secret (the opponent does not see it).
   **Owner to test** the notification tap on Android after PR #28.
4. **Owner to confirm** the five review defaults (plan §3.2: ≥ 5 battles to review, anonymous and
   final, 14 days until the judge, judge sees earlier votes, voluntary) and test push on phones
   (Profile → Notifications; iPhone only in the installed app).
5. **First real replay:** *Actions → Rating replay → Run workflow* with "force" – annulments and
   late estimates only take effect through it.
6. Multipart upload if large HD uploads fail on mobile connections; measure PBKDF2 CPU time on
   Cloudflare and raise `PASSWORD_ITERATIONS` if there is headroom.
