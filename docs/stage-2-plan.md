# Stage 2 – implementation plan

Status: draft by Claude (2026-10-11, night session), **to be confirmed by the owner**.
Stage 2 is described in `docs/concept.md` §14; this document orders the work, lists the
defaults Claude chose where the concept leaves something open, and collects the questions that
need the owner's answer. When a part is done, its details move to `docs/architecture.md` and this
document keeps only the open parts.

## 1. Order

Parts that need no answer from the owner come first, so work can go on in the meantime.
"Prepared" = already built on branch `claude/bold-planck-lrea7q` (PR waiting for review).

| # | Part | Depends on | Status |
|---|---|---|---|
| 2.1 | **Roles:** federation/admin hand out and take back judge, organizer, federation (admin: also admin); role list per person; audit log page | – | prepared |
| 2.2 | **Reports:** report button on battles, videos and profiles; list for federation/admin; close with a note | 2.1 | prepared |
| 2.3 | **Annulment:** federation annuls a decided battle with a reason → status `annulled`, replay request; admins only with federation approval | 2.1 | prepared |
| 2.4 | **Initial estimates:** athletes estimate people they know (median of ≥ 3), federation/admin set a value; late estimates request a replay | 2.1 | prepared |
| 2.5 | **Weight 4–5 with approval** by a judge/organizer (rating spec §4: rated at approval time) | 2.1 | open – question Q4 |
| 2.6 | **Review level 2** (athlete pool, "To review" list) | 2.1 | open – questions Q1, Q2 |
| 2.7 | **Review level 3** (judges) | 2.6 | open – question Q3 |
| 2.8 | **Group battles** (n people online/on site, pairs weighted 1/(n−1)) | – | open – question Q5 |
| 2.9 | **Official competitions** (organizer, results or placements, confirmation) | 2.1, 2.8 | open – question Q6 |
| 2.10 | **Filming by friends** (athlete code, inbox) | – | open – question Q7 (concept §15.2) |
| 2.11 | **Combined rankings** (official + free) | – | open – question Q8 |
| 2.12 | **Over-rating warning** (rating spec §6.2) | 2.4 | later: needs ≥ 10 battles per estimated person |
| 2.13 | **Push notifications** (Web Push) | – | open – question Q9 |

## 2. Defaults chosen for the prepared parts (please confirm or change)

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

## 3. Questions for the owner

1. **Level 2 split (concept §15.1):** 3 pool reviews and they do not all agree – majority (2:1
   decides) or always to the judges? *Claude's suggestion:* 2:1 decides with s from the mean
   of the majority, escalation to judges only if there is no majority (one undecided vote) or a
   participant objects.
2. **Level 2 pool:** how long until the rating range is widened (suggestion: start at
   ±150 around the higher rating, +100 every 48 h, everyone after 7 days)? Must reviewers have a
   minimum number of battles in the format (suggestion: 5)? Is reviewing voluntary or does
   it unlock something (e.g. you must review 1 battle per own battle)?
3. **Level 3 judges:** one judge decides, or several (majority)? Do judges see the pool votes?
4. **Weight 4–5:** who may approve – any judge/organizer, or only one not involved and from the
   same competition? Can athletes ask for it in a normal online battle at all, or only within
   official competitions?
5. **Group battles:** only on site (results entered by one person, confirmed by all), or also
   online with videos? Suggestion: start with on-site group battles (placements), online later.
6. **Competitions:** does the organizer enter placements only, or also single battles (brackets)?
   Who confirms (federation or a judge, concept §8) – one person enough?
7. **Filming by friends (concept §15.2):** suggested rule: the athlete code is entered *before*
   recording and the attempt is registered with the battle at that moment (online) or
   with a timestamp (offline); videos can only go into the battle that was selected before
   recording. OK?
8. **Combined ranking:** which formats count (all *relevant* ones?) and how are they combined
   (rating spec §8.2 has a proposal)?
9. **Push notifications:** Web Push needs a key pair (VAPID) stored as a Cloudflare secret – free,
   but the owner has to create it once (a short guide will be in `docs/deployment.md`).
   Which events: new challenge, opponent accepted, videos unlocked, review needed, chat message?
   Also: on iPhones, Web Push works only when the app is added to the home screen.
10. **Penalties (concept §15.6):** what kinds (warning, suspension for N days, rating
    deduction)? Needed before reports can lead to more than an annulment.
