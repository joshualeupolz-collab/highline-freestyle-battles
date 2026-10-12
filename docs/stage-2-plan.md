# Stage 2 – implementation plan

Status: plan by Claude (2026-10-11); the owner answered the questions on 2026-10-12 (§3).
Stage 2 is described in `docs/concept.md` §14; this document orders the work, lists the
defaults Claude chose where the concept leaves something open, and collects the questions that
need the owner's answer. When a part is done, its details move to `docs/architecture.md` and this
document keeps only the open parts.

## 1. Order

Parts that need no answer from the owner come first, so work can go on in the meantime.


| # | Part | Depends on | Status |
|---|---|---|---|
| 2.1 | **Roles:** federation/admin hand out and take back judge, organizer, federation (admin: also admin); role list per person; audit log page | – | done (PR #19) |
| 2.2 | **Reports:** report button on battles, videos and profiles; list for federation/admin; close with a note | 2.1 | done (architecture §4g) |
| 2.3 | **Annulment:** federation annuls a decided battle with a reason → status `annulled`, replay request; admins only with federation approval | 2.1 | done (architecture §4g) |
| 2.4 | **Initial estimates:** athletes estimate people they know (median of ≥ 3), federation/admin set a value; late estimates request a replay | 2.1 | done (architecture §4g) |
| 2.5 | **Weight 4–5** only in official competitions (part of 2.9) | 2.9 | done (architecture §4j) |
| 2.6 | **Review level 2** (athlete pool, "To review" list) | 2.1 | done (architecture §4h) |
| 2.7 | **Review level 3** (judges) | 2.6 | done (architecture §4h) |
| 2.8 | **Group battles** (n people online/on site, pairs weighted 1/(n−1)) | – | done: on site (architecture §4i); online later |
| 2.9 | **Official competitions** (organizer, results or placements, confirmation) | 2.1, 2.8 | done (architecture §4j) |
| 2.10 | **Filming by friends** (athlete code, inbox) | – | done (architecture §4m) |
| 2.11 | **Combined rankings** (official + free) | – | done (architecture §4k) |
| 2.12 | **Over-rating warning** (rating spec §6.2) | 2.4 | later: needs ≥ 10 battles per estimated person |
| 2.13 | **Push notifications** (Web Push) | – | done (architecture §4l) |

## 2. Defaults for parts 2.1–2.4 (confirmed by the owner, 2026-10-12)

These follow the concept; where it was silent, Claude picked the simplest fair option.

**2.1 Roles**
- The federation hands out *judge* and *organizer* (concept §2). *Federation* itself is handed out
  by an admin or the federation. *Admin* only by an admin.
- Nobody changes their own roles. Every change is in the audit log with a reason (optional).
- The *athlete* role is not handed out by hand (it comes with the approval).
- The audit log page is visible to federation and admins (concept §2: "the federation can view it").

**2.2 Reports**
- Every approved athlete can report a battle, a video or a profile with a reason (category +
  free text). Categories: *wrong result*, *fake account*, *inappropriate content*, *privacy*,
  *other*.
- Reports go to federation and admins (a badge on the profile button, like approvals).
  Closing a report needs a short note and is audited. The reporter sees that it was closed (not
  the note – it may name other people).
- Nobody handles a report about themselves or their own battle (conflict-of-interest rule).
- Not yet: hiding a video right away. Until then a video can be hidden by deleting it (owner) or
  by annulling the battle.

**2.3 Annulment**
- Only decided battles. The federation annuls with a reason; the battle gets status `annulled`
  (it stays visible with the reason), and a replay request removes it from the ratings.
- Admins (sport-related intervention): **as long as nobody holds the federation role yet, an
  admin may annul alone** (as with formats and RuleSets in stage 1); once a federation member
  exists, an admin's annulment needs a federation member's approval. The approval is stored in
  `audit_log.federation_approval_by`.
- Nobody annuls a battle they took part in.
- The rating changes only when the replay ran (the replay workflow runs daily when a request is
  open; "Run workflow" for right away). The battle page says "ratings are being recalculated".

**2.4 Initial estimates (rating spec §6.1)**
- An athlete can estimate another person in a format as long as that person has fewer than
  `MIN_BATTLES` battles in it. The value is a rating number (e.g. 1700); the app shows the
  current ranking around that number as a help ("between X and Y").
- Only the latest estimate per estimator counts; it can be withdrawn.
- Nobody estimates themselves. The estimated person does **not** see who estimated them, only
  the federation/admin does (avoids pressure between friends); the estimated person sees only
  their resulting starting value once it applies.
- A late estimate (the person already has battles in the format) creates a replay request.
- Federation/admin estimates override athletes' estimates (spec §6.1). Audited.

## 3. Decisions by the owner (2026-10-12)

1. **Level 2 – when the pool decides:** the 3 pool reviews must not contradict each other. If at
   least one review sees a side ahead and nobody sees the other side ahead ("can't decide" does
   not count against), the pool decides. As soon as one review favours A and another favours B,
   the battle goes to the judges (level 3). A 2:1 majority is **not** enough. *Default by
   Claude:* s = mean of the three reviews (a "can't decide" counts 0.5); three "can't decide"
   reviews also go to the judges.
2. **Level 2 – who may review:** open mainly **upwards**. Let R_high be the higher of the two
   participants' ratings in the format:
   - start: R_high − 150 … R_high + 150
   - after 48 h: R_high − 150 … R_high + 250
   - after 7 days: R_high − 250 … no upper limit
   These values are parameters (RuleSet), so they can be adjusted when the range proves too wide
   or too narrow. *Claude's defaults (to confirm):* reviewers need at least 5 battles in the
   format; reviewing is voluntary; a review is anonymous and final; when both athletes disagree,
   either can hand the battle to the pool at once (otherwise it goes there when the 7 days of
   level 1 are over); a pool that is not full after 14 days goes to the judges; the judge sees
   the earlier votes.
3. **Level 3 – judges:** one judge decides for now. Later: three judges, 2:1 majority.
4. **Weight 4–5:** only in **official competitions**, not in online battles. The organizer/judge
   sets the level of the competition beforehand and announces it – any level 1–5 (owner,
   2026-10-12, second answer).
5. **Group battles:** on site only for now; online group battles later. A result counts when
   **all athletes confirm it, or one official person** (judge, organizer or federation, not taking
   part) confirms it for everyone.
6. **Competitions:** if single battles exist, all of them are entered and the final placement is
   ignored for the rating; otherwise only the final placement is entered (rating spec §5.2).
7. **Filming by friends (athlete code):**
   - Online: the friend enters the athlete's code, gets the athlete's running battles to choose
     from, picks one and records.
   - Offline: the friend enters the code and a free-text description (opponent, format …) and
     records. Once online, the battles that were running at the time of the recording are shown
     and the right one is chosen. The opponent sees the description and must confirm that the
     video belongs to this battle; the athlete can also confirm or say it was assigned wrongly.
8. **Combined rankings:** official ranking = all *relevant* formats, the worst one dropped (now:
   the best 2 of 3). Federation/admin define the official configuration and adjust it when more
   formats exist. Everyone can build free combined rankings: choose formats and how many worst
   ones are dropped (rating spec §8.2).
9. **Push notifications:** for *opponent accepted*, *videos unlocked*, *review needed* and *chat
   message*; not for new challenges (people look themselves). The owner creates the VAPID key.
10. **Penalties:** not needed for now. Claude's suggestion is recorded in concept §15.

## 4. Order after the decisions

~~2.2 reports → 2.3 annulment → 2.4 initial estimates → 2.6/2.7 review levels 2–3~~ (done) → ~~2.8 on-site group battles~~ (done) → ~~2.9 competitions (with weight 4–5)~~ (done) → ~~2.11 combined rankings~~ (done) → ~~2.10 athlete code~~ (done) →
~~2.13 push notifications~~ (done).
