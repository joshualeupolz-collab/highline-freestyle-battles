# Rating System – Specification (v1.1)

Highline Freestyle Battle App · As of 2026-10-11
Reference implementation: `glicko_sim.py` (Glicko-2 core, simulation, test values)

---

## 0. Core principles

1. **Glicko-2** per battle format. Each person has, per format, a rating `r`, an uncertainty `RD` and a volatility `σ`.
2. **There is no separate overall rating.** Overall rankings (combined rankings) are always computed from the format ratings.
3. **Raw data is the source of truth; ratings are derived.** Battles, initial estimates and rule versions are stored. Ratings can be reproduced at any time by recalculating the entire history (replay).
4. **Every number in this document is a parameter** in a versioned rule set (`RuleSet`). Rule changes, e.g. after a community poll, create a new version. Ratings are then either continued with the new version from that point on or fully recalculated (admin decision).

---

## 1. Parameters (initial values)

| Parameter | Value | Meaning |
|---|---|---|
| `R_DEFAULT` | 1500 | Rating without any initial estimate |
| `SCALE` | 173.7178 | Glicko-2 conversion, fixed |
| `TAU` | 0.5 | System constant for volatility |
| `SIGMA_START` | 0.06 | Initial volatility |
| `RD_UNKNOWN` | 350 | Uncertainty without initial estimate, also the upper limit |
| `RD_START` | 200 | Uncertainty after initial estimate |
| `GRACE_DAYS` | 30 | Grace period without inactivity effect |
| `C_INACT` | 0.94 | Growth rate of uncertainty during inactivity |
| `K_DISPLAY` | 2.0 | Ranking value = r − 2·RD |
| `PROVISIONAL_RD` | 110 | Above this a rating is provisional ("?") |
| `MIN_BATTLES` | 5 | Below this a rating is provisional ("?") |
| `WEIGHT` | 1→0.25, 2→0.5, 3→1, 4→1.5, 5→2 | Weight levels |
| `K_POINTS` | 2.0 (configurable per format) | Points → score |
| `CLAMP` | `winner` | Winner never loses (alternatives: `both`, `none`) |
| `COMBO_MISSING_Z` | −1.0 | Value of a missing format in combined rankings |
| `COMBO_MIN_POP` | 10 | Minimum number of established people for a format's own spread |
| `COMBO_FALLBACK_SD` | 250 | Fallback spread for small formats |
| `OVERRATE_Z` | −3.0 | Threshold for the "over-rating" warning |

---

## 2. Glicko-2 core

Conversion: `μ = (r − 1500)/SCALE`, `φ = RD/SCALE`.

For person A with comparisons j = 1..m (opponent `μj`, `φj`, score `sj ∈ [0,1]`, weight `wj`):

```
g(φ)  = 1 / sqrt(1 + 3φ²/π²)
Ej    = 1 / (1 + exp(−g(φj)·(μ − μj)))
v     = 1 / Σ wj · g(φj)² · Ej · (1 − Ej)
Δ     = v · Σ wj · g(φj) · (sj − Ej)
σ'    = volatility iteration per Glickman (Illinois method, ε = 1e-6), see reference code new_sigma()
φ*    = sqrt(φ² + σ'²)
φ'    = 1 / sqrt(1/φ*² + 1/v)
μ'    = μ + φ'² · Σ wj · g(φj) · (sj − Ej)
```

Convert back: `r' = 1500 + SCALE·μ'`, `RD' = SCALE·φ'`.

The weight `wj` is the only deviation from the original. A battle with weight 2 counts like two identical battles. This replaces the K-factor of classic Elo.

### 2.1 Immediate updates

There are no rating periods. Every **event** is processed immediately. An event is a single battle, a group battle or a competition result.

- All participants of an event are updated **simultaneously**, always using their values from before the event.
- **Event timestamp** = the moment the result becomes final and counts: decided by review, confirmed by both sides (on-site), approved (levels 4–5, see section 4) or confirmed (competitions). Because new events then almost always come after all processed ones, a replay is only needed in exceptional cases (annulment, merging formats, a late initial estimate, a full recalculation with a new RuleSet).
- Replay order: by event timestamp, ties broken by ID. The result must be deterministic.

### 2.2 Inactivity (before every calculation and for every display)

```
t      = days since last battle in this format
RD_eff = min(RD_UNKNOWN, sqrt(RD² + (C_INACT · max(0, t − GRACE_DAYS))²))
```

- `RD_eff` is used as the starting RD for the next update and shown in every ranking.
- **Inactivity never changes the rating r.** No points are destroyed or redistributed. This prevents inflation and deflation.

Effect on the ranking (previous RD 50):

| Days inactive | 30 | 60 | 90 | 120 | 180 | 270 | 365 | ≥ ~500 |
|---|---|---|---|---|---|---|---|---|
| RD | 50 | 57 | 75 | 98 | 150 | 231 | 319 | 350 |
| Ranking deduction | 0 | −15 | −51 | −97 | −199 | −362 | −538 | −600 |

### 2.3 Protection rule "winner never loses" (`CLAMP`)

For each person in an event, the outcome is determined first: `outcome = Σ wj·(sj − 0.5)`.

- `CLAMP = winner`: if `outcome > 0` and the new rating is lower than the old one, the old rating is kept. RD and σ are still updated normally.
- `CLAMP = both`: additionally, if `outcome < 0` and the new rating is higher than the old one, the old rating is kept.
- Known side effect of `winner`: a slight increase in points. In the simulation this was about +7 points over 2 years. See section 9.
- The `both` variant should be decidable by community poll. Switching the RuleSet version is sufficient.

---

## 3. Battle result (score s)

One result type is chosen per battle:

| Type | Score for person A |
|---|---|
| Win/loss only | 1 / 0 |
| 5-point scale | 1 · 0.75 · 0.5 · 0.25 · 0 |
| Points a : b | `s = a^k / (a^k + b^k)`, k = `K_POINTS` of the format. If both are 0, s = 0.5 |
| Draw | 0.5, **only if both sides confirm** |

The score for person B is always `1 − s`.

Examples with k = 2: 100:90 → 0.55 · 150:80 → 0.78 · 200:50 → 0.94 · 120:0 → 1.0

---

## 4. Weight 1–5

| Level | Factor | Who may choose the level? |
|---|---|---|
| 1 fun | 0.25 | everyone |
| 2 | 0.5 | everyone |
| 3 normal | 1.0 | everyone |
| 4 | 1.5 | only with approval (judge/organizer) |
| 5 official competition | 2.0 | only with approval (judge/organizer) |

**Decided:** battles at level 4–5 count only after approval. Until then they do not enter the rating at all (status `pending`). On approval, the event is rated with the approval time as its event timestamp (section 2.1), so no replay is needed. *(Changed in v1.1; v1.0 placed it at the battle time and recalculated from there.)*

---

## 5. Group battles and competitions

### 5.1 Group battle with n people

- The battle is split into all pairs. Each pair is scored with weight `WEIGHT[level] / (n − 1)`.
- Score per pair: from placement (better = 1, equal = 0.5) or from points (formula from section 3).
- All pairs together form **one** event with a simultaneous update.
- Effect: each person receives in total exactly the weight of one single battle at the chosen level.

### 5.2 Official competition

- If **individual or group results** exist for a competition in a format, **only those** are scored. The final placement is then ignored for rating purposes, so nothing is counted twice.
- If **only the final placement** exists, it is treated like a group battle with all participants. Usually level 5, i.e. weight per pair `2/(n−1)`.
- Tied placements are scored as draws (0.5).

---

## 6. Initial rating and detection of over-rating

### 6.1 Starting value

| Situation | Starting rating | Starting RD |
|---|---|---|
| no estimate | 1500 | 350 |
| admin estimate | given value | 200 |
| estimate by users (≥ 3 estimates) | median of the estimates | 200 |

- Every estimate is stored as a record: who rated whom, in which format, with which value, when.
- An estimate is only possible while the person has fewer than `MIN_BATTLES` battles in that format. If it is given after the person's first battles, it still defines the **starting value** and the ratings are recalculated from the start (replay).
- If an athlete revises their estimate, only the latest one counts. If several admin/federation estimates exist, the latest one counts.

### 6.2 Detecting over-rating

For each person with an initial estimate who has at least 10 battles in a format, two values are computed:
- `drift = r (after 10 battles) − starting value`
- `residual = Σ w·(s − E) / Σ w` over the first 10 battles

These are then evaluated per group. Groups can be: one estimating person, a region or a community tag.

```
z = mean(drift) / (sd(drift) / sqrt(n))     (n ≥ 5)
```

- `z < OVERRATE_Z (−3)`: warning to the admin "This group systematically rates too high", showing the mean deviation.
- `z > +3`: correspondingly "rates systematically too low".
- Optional for later: automatically correct new estimates from this group by the mean deviation.

In the simulation, a group rated 250 points too high was reliably detected (z between −5 and −9).

---

## 7. Formats

- Format fields: `name`, `status` (`relevant` | `fun`), `k_points`, `merged_into` (optional).
- New formats can be proposed by users. They start with status `fun`. An admin can promote them to `relevant`.
- **Merging:** format B is linked to A via `merged_into = A`. From then on, all battles of B count as battles of A, followed by a replay. This is reversible because the raw data remains unchanged.
- Ratings are computed for all formats regardless of status. The status only determines whether a format may appear in official combined rankings.

---

## 8. Rankings

### 8.1 Format ranking

- Sorted by `R = r − K_DISPLAY · RD_eff`.
- Display: rating, ± RD and "?" if `RD_eff > PROVISIONAL_RD` or battles < `MIN_BATTLES`.
- **Counting battles:** every event counts as one battle for each participant. A group battle or a competition placement is one battle, not n − 1, matching its total weight of one single battle (section 5.1).
- Provisional ratings are shown, not hidden.

### 8.2 Combined ranking

A combined ranking is a stored configuration:

```
{ formats: [...], drop_worst: X, missing_z: -1.0, official: true/false }
```

Calculation at a point in time:
1. **Normalization per format:**
   - The base population is all non-provisional people in the format.
   - From these, mean `m_f` and spread `sd_f` of R are computed.
   - With fewer than `COMBO_MIN_POP` people, `sd_f = COMBO_FALLBACK_SD` and `m_f` is the mean of all existing people.
2. **Per person and format:** `z_f = (R_f − m_f) / sd_f`. If the person has never played the format, `z_f = missing_z`.
3. The **X worst** z-values are dropped.
4. **Combined value** = mean of the remaining z-values.
5. A person appears only if they have at least 1 real format in the selection.

Worked example with 3 formats:

| Athlete | z per format | X=0 | X=1 | X=2 |
|---|---|---|---|---|
| Anna (all-rounder) | 1.12 / 1.05 / 0.97 | 1.05 | 1.09 | 1.12 |
| Ben (one format only) | – / – / 2.77 | 0.26 | 0.89 | 2.77 |
| Carla (two formats) | 1.52 / 1.90 / – | 0.81 | 1.71 | 1.90 |
| David (after a break) | 1.36 / 1.20 / 1.30 | 1.29 | 1.33 | 1.36 |
| Emil (newcomer) | −0.40 / −1.00 / −0.50 | −0.63 | −0.45 | −0.40 |

**Official ranking:**
- A configuration locked by the admin, e.g. "all relevant formats, worst 2 dropped".
- It may only contain formats with status `relevant`.

**Free rankings:**
- Anyone can freely choose formats and X via filters, e.g. for a competition with 4 formats.
- Free rankings are not stored unless someone wants to share them.

---

## 9. Inflation and deflation

- The Glicko-2 core is not exactly zero-sum, but does not create systematic drift on its own.
- In the simulation (120 people, 3 formats, 2 years, 3 runs) the mean rating rose by about 15–25 points per year. Causes:
  1. over-rated people hand their surplus points to their opponents,
  2. the "winner never loses" rule.
- **Impact:** the order in rankings is unaffected. Combined rankings use z-values and are therefore immune as well. Only absolute numbers over long periods are affected.
- **Measures:**
  - The admin sees the mean of established, active people per format in the dashboard.
  - Optional (parameter `ANCHOR`, off by default): once a year, all ratings of a format are shifted by the same amount so that this mean returns to the target value. The order does not change.

---

## 10. Data model (minimum)

```
Format(id, name, status, k_points, merged_into, created_by, created_at)
Event(id, format_id, kind: single|group|competition_placement, level 1–5,
      approved_by?, competition_id?, timestamp, status: pending|confirmed|rejected)
EventResult(event_id, person_id, points?, placement?, scale_value?)   -- raw data
DrawConfirmation(event_id, person_id)
Estimate(id, subject_id, estimator_id, format_id, value, timestamp)
RuleSet(version, parameter-JSON, valid_from, note)
RatingState(person_id, format_id, r, rd, sigma, last_battle_at, n_battles, ruleset_version)  -- derived, cache
RatingHistory(event_id, person_id, format_id, r_before, r_after, rd_before, rd_after)        -- for "+12" display
ComboConfig(id, name, format_ids, drop_worst, missing_z, official, locked_by)
```

`RatingState` and `RatingHistory` can be fully regenerated at any time from `Event`, `EventResult`, `Estimate` and `RuleSet`.

The actual database schema is described in `docs/architecture.md`.

---

## 11. Test values for the implementation

Parameters: σ = 0.06, τ = 0.5, weight 1, no protection rule. Values must be reproduced to ±1 point.

| A (r±RD) | B (r±RD) | s(A) | Δr A | new RD A | Δr B |
|---|---|---|---|---|---|
| 1600±60 | 1500±60 | 1 | +7 | 60 | −7 |
| 1600±60 | 1500±60 | 0 | −13 | 60 | +13 |
| 1600±200 | 1500±60 | 1 | +63 | 176 | −7 |
| 3000±50 | 2000±50 | 0 | −15 | 51 | +15 |
| 3000±176 | 2000±50 | 0 | −176 | 176 | +13 |
| 3000±176 | 2000±50 | 1 | +1 | 176 | 0 |
| 3000±176 | 2000±50 | 0.25 | −132 | 176 | +10 |

Weights for 1600±60 beats 1500±60: weight 0.25 → +2, weight 1 → +7, weight 2 → +14.

Inactivity: previous RD 50, 210 days inactive → RD_eff = 176.

---

## 12. Explanation for athletes (short version)

- You have a **rating** and an **uncertainty** per format. New, not battled for a long time, or few battles means: high uncertainty and a "?" after your rating.
- Beat someone rated stronger and you gain a lot of points. Against someone rated weaker you gain few.
- The clearer your win and the higher the battle level, the more the battle counts.
- **If you win, you never lose points.** If you narrowly lose to someone much better, you can still gain points.
- If you take a break, you keep your points. But you slowly slide down the ranking, because the system is no longer sure how strong you currently are. A few battles after returning are enough to get back in.
- Overall rankings are computed from your format ratings. Depending on the ranking, your weakest formats are dropped.

---

## 13. Decision log and interfaces to other sub-projects

**Decided ("Rating system" chat, 2026-10-11):**
- Glicko-2 per format, with immediate updates after every event. No separate overall Elo.
- Battle weighting via a weight factor per battle instead of a K-factor. Levels 4–5 only after approval.
- Margin is selectable per battle. For points, the formula with k = 2 applies; the value can be changed per format.
- "Winner never loses" is active. "Loser never gains" is currently **not** active and should be decidable by community poll.
- Inactivity only acts through increasing uncertainty. Rankings sort by r − 2·RD.
- Combined rankings are based on z-values. The worst X formats are dropped; a missing format counts as −1. There is one official, locked configuration plus freely filterable variants.
- Formats have status `relevant` or `fun`. Similar formats can be merged via `merged_into`.

**Decided (project start, 2026-10-11, v1.1):**
- Event timestamp = time the result becomes final. Levels 4–5 are rated at the time of approval, without a replay (section 4).
- A group battle or competition placement counts as one battle for `MIN_BATTLES` (section 8.1).
- A late initial estimate (person has already battled, but fewer than `MIN_BATTLES` times) applies retroactively as starting value (section 6.1).
- Points of a battle in a merged format are converted with the `k_points` of the format it was played in.

**Required from other sub-projects (app, backend, UI):**
- A poll feature for rule changes, producing a new RuleSet version.
- An approval workflow for levels 4–5 by judges/organizers.
- A confirmation workflow for results and draws. Both sides must confirm.
- An admin dashboard with warnings about over- and under-rating and the mean per format (inflation control).
- An initial-rating interface for admins and users.

**Implementation notes for Claude Code:**
- The rating engine should be a standalone, pure module without database access. Input: events, estimates and a RuleSet. Output: RatingState and RatingHistory.
- Write unit tests against the values in section 11.
- `glicko_sim.py` is the reference. New implementations must produce the same numbers.
