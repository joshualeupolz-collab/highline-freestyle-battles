# Highline Freestyle Battle App – Concept (v0.1)

As of 2026-10-11 · Complements the rating specification `rating/rating-specification.md` (v1.0)

---

## 0. Goal and scope

- A web app for highline freestyle battles, similar to online chess: athletes compete worldwide with self-filmed videos. This produces rankings per battle format as well as combined rankings.
- Target size at launch: about 100 active and 1,000 registered users worldwide.
- **Free and openly accessible.** Running costs as close to €0 as possible. Small costs are acceptable if they make the app significantly simpler or better.
- **Open source** (public GitHub repository). Additional contributors should be able to get started easily.
- The community knows each other and fun comes first. The app should still feel official.

---

## 1. Core principles

1. **Trust instead of surveillance.** Restrictions target "casual cheating" (e.g. "never mind, I'll just film again"), not deliberate fraud. Deliberate fraud is handled through reporting, the audit log and the federation.
2. **Everything can be changed if both sides agree.** Battle settings (attempts, time window, cancellation, extra attempt, …) can be adjusted at any time through a change request. One side proposes, the other confirms.
3. **Raw data is the source of truth.** Battles, results, initial ratings and rule versions are stored. Ratings are derived and can be recalculated at any time (see rating specification).
4. **Rules are data, not code.** Formats, trick list, judging rules and rating parameters are versioned. Every battle records which version it was scored with.
5. **Separation of powers.** The admin is responsible for the technical side; the federation / sports commission is responsible for everything sport-related.
6. **Conflict-of-interest rule.** Nobody acting in a special role makes decisions about battles they are involved in.

---

## 2. Roles and permissions

A person can hold several roles (e.g. athlete + judge).

| Role | Permissions |
|---|---|
| **Guest** | Films for someone else using an athlete code. No account needed. |
| **Athlete** | Request and accept battles, upload videos, judge in the review pool, tag tricks, propose formats, take part in polls, approve/invite new users, give initial estimates for people they know, report content |
| **Judge** | In addition: review level 3, approval of battle weight 4–5 |
| **Organizer** | Create official competitions, enter results |
| **Federation / sports commission** | Assign judge and organizer roles, approve users, set or override initial ratings, confirm, revise or annul results, impose penalties, handle reports, manage formats, trick list and rule set, promote beta formats to standard |
| **Admin** (2–3 people) | Technology, deployments, database, backups. Has the federation's permissions in principle, but **sport-related interventions only with federation approval** |

**Transparency:** Every action using special permissions is recorded in an audit log (who, what, when, reason). The federation can view it. Because ratings are reproducible from raw data, hidden changes become visible on recalculation.

---

## 3. Accounts, approval, initial rating

- **Login:** username + password, optionally "Sign in with Google". An email address is optional. Without an email there is no "forgot password"; the admin or federation resets the password instead: they create a one-time code (valid 24 hours) and hand it over personally.
- **First admin:** whoever registers with a secret setup token while no admin exists yet becomes the first admin.
- **Age:** a checkbox at sign-up: "I am at least 16 years old." Younger users contact the federation; they are approved case by case with parental consent.
- **Approval:** new accounts must be approved, by an existing athlete, the federation or an admin. An optional short questionnaire (e.g. how long they have been doing freestyle, community/location).
- **Invitation tree:** the app stores who approved whom. This helps detect rings of fake accounts.
- **Initial rating per format:** set by an admin, the federation or at least 3 athletes (median), see rating specification section 6. Detection of systematic over- and under-rating per group is described there.

---

## 4. Battle formats

- Formats are **records, not code**. A format consists of a list of **parts**, each with its own rules, e.g.:
  - "Best Trick" (1 trick)
  - "3-Trick Combo" (fixed number of tricks)
  - "10-Bounce Combo" (fixed number of bounces)
  - "Response" (repeat your opponent and add something – back-and-forth formats)
- A battle can therefore consist of several videos (e.g. Best Trick + 3-Trick Combo + 10-Bounce Combo) and several rounds.
- Launch formats: 3-Trick Combo, 10-Bounce Combo, Best Trick.
- **Parts (decided):** each part is one video and limits either a number of **tricks** (transition bounces between tricks are allowed; a best trick is 1 trick), a number of **bounces** (every bounce counts), or is **other** (described in free text). Name and free description explain the rest. More part types can be added once a need becomes clear.
- **Format proposals (decided, already in stage 1):** every athlete can propose a format (name, description, parts). A proposal cannot be used until the federation or admin approves it, either as **official** (`relevant`, shown as a tile when creating a battle) or as **other format** (`fun`, under "more formats"), or rejects it with a note for the proposer. Promoting `fun` to `relevant` later is possible, optionally after a poll.
- Similar formats can be merged for rating purposes (`merged_into`, see rating specification section 7).

---

## 5. Battle flow (online)

1. **Request:** an athlete posts an open request for a format. Others see matching requests sorted by rating proximity, including the challenger's rating. Accepting or ignoring is up to them. An athlete can also **challenge one person directly**; only that person can accept, and direct challenges are listed first.
2. **Settings** (set by the challenger, or marked "flexible" so both agree on them). Requests show whether the rules are **fixed** (accepting starts the battle) or **negotiable**. Every step that makes the battle binding (accepting fixed rules, starting with the negotiated rules, accepting a rule proposal that starts the battle) asks for confirmation, because from then on giving up or missing the deadline can cost rating points:
   - Format
   - Attempts per video: any number (1–99) or unlimited
   - Deadline: a fixed **end date and time** (not a duration, so time spent waiting for an opponent counts), up to 60 days ahead, or no deadline. Default: in 7 days at **05:00 German time** (Europe/Berlin), so people in the Americas still have the whole previous day. The other side can propose a different deadline. Requests whose deadline passes before anyone accepts expire.
   - Weight 1–5 (1 = fun … 5 = official competition). Levels 1–3 can be chosen freely; 4–5 only after approval by a judge or organizer.
   - Scoring type: win/loss only, or with margin
   - Review mode: Quick (5-point scale) or Detailed (score sheet, later stage)
3. **Recording and upload** (see section 6). Several battles can run in parallel, including several against the same person.
4. **Unlocking:** both sides' videos become visible only once **both** have uploaded. Exception: back-and-forth formats, where you see your opponent's video before your response.
5. **Review** (see section 7).
6. **Special cases:**
   - Whoever doesn't deliver within the time window loses. The opponent may instead choose "cancelled, unrated".
     If the side that delivered does not decide within **7 days** after the deadline, the battle counts as their win automatically; if nobody delivered, it is cancelled unrated (hourly background job).
   - If one side wants to cancel, the other decides: count it as a win or cancel without rating.
   - Goodwill: the opponent can grant an extra attempt or more time (e.g. after a mis-tap that can be shown on video). Granting an extra attempt asks for confirmation; taking it back is only possible if the receiving side agrees.
7. **Chat:** the participants of a battle can exchange messages. Only they can read them (later also the federation for a reported battle). Messages of a deleted account are deleted.

---

## 6. Recording

- **Recording only inside the app**, no upload from the gallery.
- **Attempt limit:** pressing Start uses up an attempt. The recording is kept and cannot be discarded. Target level "moderately secure": prevent casual cheating; a watertight lock is not required.
- **Best of N (decided):** all attempts of a battle are uploaded. Before the videos are unlocked, the athlete chooses which attempt counts; the opponent and the reviewers only rate that one. The other attempts are deleted after the battle by default, unless the athlete chooses to keep them (e.g. good trick footage for the video database), with their own visibility.
- On start, an attempt record with a timestamp is created and checked at upload. Optionally a random code or the time can be overlaid on the video.
- **Quality levels** chosen before recording: Data saver / Normal / HD. Recording happens directly at that quality, without re-compressing on the phone. A hint explains that HD is worthwhile for training videos.
- **Rough trimming on the phone:** mark start and end, e.g. one bounce before the combo and 1–2 bounces after. Cut without re-encoding, which is fast. The rest is not uploaded.
- **Cut points:** the user marks (later with auto-suggestions) the individual bounces or tricks as timestamps. One video plus a list of cut points is stored; actual single clips are created server-side (section 10).
- **Offline:** the app works offline (PWA). Videos are stored locally and survive an app crash. Upload happens automatically once there is a connection and the app is open. iPhones do not support background upload.
- **Filming by friends:** every athlete has a **fixed athlete code** they can change themselves. The person filming opens the app (no account needed, but the app must have been opened online once), enters code + opponent name and films. The opponent name tolerates typos.
  - The video goes to the athlete's **inbox** and is assigned to the matching battle on upload.
  - The opponent sees the code/name used and the recording time.
  - Open: abuse through assigning videos to the "best" battle afterwards when several are open (see section 15).
- **Visibility** is chosen per video at upload (see section 12).

---

## 7. Review

### 7.1 Level 1 – the two athletes
- Both vote separately on the 5-point scale: *A clearly better · A somewhat better · can't decide · B somewhat better · B clearly better*.
- The result is shown only once both have voted.
- **Agreement** = both on the same side. The battle is then decided.
- Disagreement or neutral → level 2.
- A draw only if both confirm it.

### 7.2 Level 2 – athlete pool
- Eligible reviewers are athletes with a similar or slightly higher rating in the format, preferably slightly higher. Participants are excluded.
- Open reviews appear in a "To review" list when the app opens.
- 3 reviews are collected, also on the 5-point scale.
- If a battle stays open too long, the allowed rating range is gradually widened up and down.
- All agree → decided. Otherwise → level 3.

### 7.3 Level 3 – judges
- Certified judges make the final decision.

### 7.4 Detailed mode (later stage)
- Score sheet per video: tricks with suggested points from the trick list (base trick + variation ± execution) plus subjective categories (combo/order, variety, style).
- Both see the other side's scoring and the differences. A formula computes a suggestion; the 5-point scale remains the final decision.
- Scoring formula and trick list come from outside (a parallel project by another developer). They are imported and replaceable (section 9).

### 7.5 Hand-off to the rating
- Win/loss only: s = 1 / 0.
- With margin: s from the 5-point scale (1 · 0.75 · 0.5 · 0.25 · 0) or from points (rating specification section 3).
- Proposal for level 1: s = mean of the two (mirrored) assessments. Example: "A clearly" (1) and "A somewhat" (0.75) give s(A) = 0.875. To be confirmed.

---

## 8. On-site battles, group battles, competitions

- **On-site battle:** only the result is entered (optionally with margin and video). It counts once **both confirm**. Weight selectable as for online battles.
- **Group battle (n people):** split into pairs; each pair counts 1/(n−1) (rating specification section 5.1).
- **Official competition:** the organizer creates it and enters results, either individual or group battles (possibly with points) or only final placements. Individual results take precedence over final placements. Confirmation by the federation or a judge (rating specification section 5.2).
- **Live streaming** of on-site battles: future idea (section 14).

---

## 9. Trick list and video database (later stage)

- The existing trick list is **imported** (no scoring system of our own). Exchange with the other developer is initially manual via export/import.
- Agree early with the other developer on **stable trick IDs** and a shared exchange format (e.g. JSON: ID, name, variations, points).
- Users can add new tricks. They get the status "proposed" until the federation approves them (prevents duplicates).
- **Entering tricks is not mandatory** but strongly encouraged. The athlete, the opponent or volunteers ("tag videos") can enter them.
- Input: base trick via autocomplete, variation(s), free-text comment.
- **Quality rating per video** (image quality, angle, suitability as a training video) to filter the database.
- Later: clustering tricks (strength / technical / rotation) for better combo scoring as a beta rule set; AI trick recognition via body tracking as a suggestion list (section 14).

---

## 10. Video storage, processing, archive

- **Active storage: Cloudflare R2.** The phone uploads directly using an upload permission issued by the server. 10 GB free, then $0.015/GB/month. Downloads are free.
- **Processing** (scheduled via GitHub Actions, later possibly a home server): compression by quality level and rating, splitting into single clips using the cut points, deleting raw files no longer needed.
- **Archive:** after X weeks, videos are moved automatically to a **private Telegram channel** (as single clips, < 20 MB). The message ID is stored in the database. They can be fetched back to R2 when needed. If the bot is banned, the files remain in the channel and a new bot or the owner's own account can retrieve them.
- **Second copy:** external hard drive (1–2 TB).
- Keep the **storage layer replaceable** (interface) so providers can be switched.
- **Deletions must apply everywhere:** R2, Telegram archive and hard drive.

---

## 11. Moderation, polls, audit log

- **Report button** for videos, battles and profiles. Reports go to the federation and admins.
- **Annulment:** a battle is set to "annulled", then ratings are recalculated (replay). Knock-on effects disappear too, e.g. with boosted fake accounts.
- **Penalties** by the federation (type and scope open).
- **Poll module** (general purpose): for beta formats, rule changes (e.g. rating rule `CLAMP`) and other topics. The result is a recommendation; the federation or admin decides.
- **Audit log** of all actions using special permissions (section 2).

---

## 12. Privacy and legal

- The app is used worldwide. **The GDPR is the benchmark**, as it is the strictest rule almost everywhere.
- **Profiles and rankings** are visible to logged-in, approved users only, not publicly on the internet.
- **Visibility per video**, chosen at upload:
  - **public** (default, with explanation)
  - **logged-in users only**
  - **review only** (deleted once the review is complete)
- **Account deletion:** the user chooses whether their videos stay or are deleted. The profile becomes "deleted user"; battle results and opponents' ratings remain. The user receives a **deletion link** for later deletion requests.
- Minimum age 16 by self-declaration; exceptions case by case with parental consent. If we learn of an under-16 user without consent, the account is suspended or deleted.
- Required: privacy policy (EN + DE), legal notice ("Impressum", operated from Germany), terms of use. To be drafted separately and briefly checked by someone qualified.

---

## 13. Technology

| Component | Choice |
|---|---|
| App | Progressive Web App (PWA), TypeScript, offline-capable. **React** (Vite, static single-page app), chosen for its reach among possible contributors. |
| Hosting | **One Cloudflare Worker with static assets** serves the PWA and the API from the same address (initially the free `*.workers.dev`). Same origin means login cookies work in every browser, including Safari. Requests for static files are free and unlimited. Own domain (~€10/year) only once successful. |
| Server logic | Cloudflare Workers (Free: 100,000 requests/day, enough for about 1,000 daily active users; then Workers Paid $5/month) |
| Database | Cloudflare D1 (SQLite, Free: 5 GB/account) |
| Videos | Cloudflare R2; archive on Telegram + hard drive |
| Login | Small own session login (username/password, optional Google via the `arctic` library). Passwords are stored only as salted, slow PBKDF2 hashes plus a secret pepper that is kept outside the database. Details: `docs/architecture.md`. |
| Notifications | Web Push (iPhone: app must be added to the home screen) |
| Background jobs | GitHub Actions (video processing, archiving, full rating replay) |
| Rating engine | Pure TypeScript module without database access; unit tests against rating specification section 11. `glicko_sim.py` remains the reference. |
| Code | Public GitHub repository, developed with Claude Code |
| Optional later | Android APK via Capacitor (same code, no store). iPhone stays a web app, no App Store ($99/year). |

**Costs:** €0 at launch. Later probably a few euros per month (R2 above 10 GB, possibly Workers Paid, domain).

**Addition to the rating specification (planned for a later version):** people whose `RD_eff` has reached the cap `RD_UNKNOWN` are **hidden** from rankings. Their rating stays stored and applies again immediately on return. A shorter period can apply to people with few battles (parameter).

---

## 14. Development stages

**Stage 1 – Core (MVP)**
- Accounts, login, approval, age confirmation
- Formats (created by admin), battle request, acceptance, settings, change requests
- In-app recording with attempt limit, quality levels, rough trimming, **offline storage**
- Upload to R2, unlocking after both have uploaded
- Review level 1 (5-point scale)
- Rating engine (Glicko-2 per specification), format rankings
- Profiles (ratings per format, recent battles), chat per battle, format proposals (pulled forward after the first test round)
- On-site results with confirmation from both sides

**Stage 2 – Competition operation**
- Filming by friends with athlete code, inbox
- Review level 2 (pool, "To review") and level 3 (judges)
- Roles judge, organizer, federation; audit log, reporting, annulment
- Group battles, official competitions, weight 4–5 with approval
- Combined rankings (official + free), initial ratings by athletes, over-rating warning
- Push notifications

**Stage 3 – Database and community**
- Trick list import, trick tagging, quality rating, detailed mode
- Cut points, splitting into clips, Telegram archive
- Beta formats, poll module, multi-round and back-and-forth formats

**Future**
- AI trick recognition (body tracking → trick suggestions)
- Auto-cut at the bottom dead center of the bounce
- Gesture start for continuous filming (session camera)
- Live streaming of on-site battles
- Android APK

---

## 15. Open questions

1. Level 1: confirm how s is computed from the two assessments (proposal in 7.5).
2. Level 2: what applies on a 2:1 split in the pool – majority or escalation to judges? How long until the rating range is widened?
3. Athlete code offline: how do we prevent videos from being assigned to the "best" battle afterwards (fix the assignment before recording, timestamps, visibility to the opponent)?
4. Default values: time window, attempts, weight. *Provisional defaults in the app: best of 3 attempts, deadline in 7 days at 05:00 German time, weight 3, 5-point scale (`packages/shared/src/battles.ts`, `deadline.ts`).*
5. Archiving: after how many weeks to Telegram?
6. Video prototype: test recording quality, trimming and splitting on real iPhones and Android phones.
7. Exchange format for trick list / scoring formula with the other developer.
8. Type and scope of federation penalties.
9. What happens to open battles when an account is deleted?

---

## 16. Sub-projects and model recommendation

| Sub-project | Where | Model |
|---|---|---|
| Rating system | separate chat (v1.0 done) | Opus |
| Main development | Claude Code, public GitHub repository | Opus for architecture and tricky parts, Sonnet for implementation |
| Video prototype (recording, trimming, offline) | Claude Code, separate branch or mini repo | Sonnet |
| Legal texts (privacy policy, legal notice, terms) | separate chat | Sonnet |
| Trick list / exchange format | coordination with the other developer, possibly a separate chat | Sonnet |
| AI trick recognition | later, separate chat or Claude Code | Opus |
