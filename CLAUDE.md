# CLAUDE.md – Working instructions for this repository

## The project in one sentence

A free, open web app for highline freestyle battles with in-app video recording, tiered review and a
Glicko-2 rating per format. Full concept: `docs/concept.md`. Rating: `rating/rating-specification.md`.

**Read the relevant sections of these two documents before any larger task.** They are the binding
basis. If the code deviates from them, that is a bug – or the document needs to be updated after
agreement.

## Language

- **Everything in the repository is in English:** code, identifiers, comments, docs, commit messages,
  issues, PR descriptions and all user-facing text in the app (the app should be easy to localize later).
- The project owner may write to you in German. Reply in the language they write in.

## How to work

- **Evaluate change proposals before implementing them.** For changes to the concept, rules or
  architecture: present the proposal and an assessment (effort, risks, alternatives) and wait for
  confirmation. Obvious small things (bug fixes, typos, clear improvements without side effects) can be
  done directly.
- **Follow the development stages** (`docs/concept.md` section 14). Don't jump ahead, but design the
  data model with later stages in mind so no rebuild is needed.
- **Costs:** operation must stay within the free tiers of Cloudflare and GitHub. Raise anything that
  could cause ongoing costs before doing it.
- **Contributors:** write code and docs so newcomers can get started.
- Suggest moving self-contained sub-tasks (e.g. legal texts, rating maths) into separate sessions.
- Keep the docs up to date: record new decisions in `docs/concept.md` and remove resolved items from
  its section 15.

## Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript (strict) |
| App | PWA, offline-capable (service worker, IndexedDB for videos) |
| Hosting | Cloudflare Pages (`*.pages.dev`) |
| API | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite), versioned migrations in the repo |
| Videos | Cloudflare R2, uploaded directly from the phone via signed URL |
| Background jobs | GitHub Actions (video processing, archiving, rating replay) |
| Tests | Vitest |

Mind the free-tier limits: Workers Free = 100,000 requests/day and very little CPU time per request →
nothing compute-heavy in the Worker (no video, no full rating replay). D1 Free = 5 million rows read /
100,000 rows written per day → use indexes, avoid full table scans.

## Architecture rules

1. **Raw data is the source of truth.** Battles, results, initial estimates and rule versions are
   stored; ratings are derived and reproducible at any time via replay.
2. **Rules are data.** Formats, rating parameters (`RuleSet`), and later the trick list and scoring
   formula are versioned records, not hard-coded. Every battle stores the version it used.
3. **Rating engine** (`packages/rating` or similar): a pure module without database or network access.
   Input: events, estimates, RuleSet. Output: RatingState, RatingHistory. Unit tests against
   `rating/rating-specification.md` section 11. `rating/glicko_sim.py` is the reference – results must
   match within ±1 point.
4. **Replaceable storage layer** (interface for video storage: R2, later a Telegram archive).
5. **Check permissions centrally.** Roles: guest, athlete, judge, organizer, federation, admin.
   Conflict-of-interest rule: nobody decides on their own battles in a special role. Sport-related
   admin interventions only with federation approval. Every action using special permissions goes into
   the audit log.
6. **Privacy:** GDPR is the benchmark. Visibility per video (public / logged-in / review only);
   deletions must apply to every storage location. No secrets (API keys, tokens) in the repo – only via
   Cloudflare / GitHub secrets.

## Repository structure (target, created at project start)

```
docs/               concept and further documentation
rating/             rating specification and Python reference
apps/web/           PWA (frontend)
apps/api/           Cloudflare Worker (API)
packages/rating/    rating engine (TypeScript, pure)
db/migrations/      D1 migrations
.github/workflows/  CI and background jobs
```
