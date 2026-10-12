/**
 * Full rating recalculation ("replay", docs/architecture.md section 3).
 *
 * Normally the Worker applies each decided battle on its own. A replay recalculates every rating
 * from the raw data: after an out-of-order event, an annulment, merged formats, a late initial
 * estimate or a new RuleSet. It runs in GitHub Actions (`scripts/replay.ts`), not in the Worker,
 * because it reads the whole history.
 *
 * This module is pure apart from the SQL text: the script fetches the rows with REPLAY_QUERIES,
 * `computeReplay` runs the engine and `replayStatements` returns the SQL that replaces
 * `rating_states` and `rating_history` and closes the open replay requests.
 */
import {
  type Estimate,
  type FormatInfo,
  type RatingEvent,
  type RuleSetParams,
  replay,
  type WeightLevel,
} from '@hfb/rating';
import { ruleSetParamsSchema } from '@hfb/shared';

export const REPLAY_QUERIES = {
  openRequests: 'SELECT id FROM replay_requests WHERE done_at IS NULL',
  battles: `SELECT b.id, b.format_id, b.level, b.ruleset_version, b.event_at, p.user_id, p.seat, p.score, p.placement
    FROM battles b JOIN battle_participants p ON p.battle_id = b.id
    WHERE b.status = 'decided' AND b.event_at IS NOT NULL
    ORDER BY b.event_at, b.id, p.seat`,
  estimates: `SELECT subject_id, estimator_id, format_id, kind, value, created_at
    FROM rating_estimates WHERE withdrawn_at IS NULL`,
  rulesets: 'SELECT version, params_json FROM rulesets',
  formats: 'SELECT id, k_points, merged_into FROM formats',
} as const;

export interface ReplayRows {
  battles: {
    id: string;
    format_id: string;
    level: number;
    ruleset_version: number;
    event_at: number;
    user_id: string;
    seat: number;
    score: number | null;
    placement: number | null;
  }[];
  estimates: {
    subject_id: string;
    estimator_id: string;
    format_id: string;
    kind: Estimate['kind'];
    value: number;
    created_at: number;
  }[];
  rulesets: { version: number; params_json: string }[];
  formats: { id: string; k_points: number | null; merged_into: string | null }[];
}

/** Runs the engine over the whole history. */
export function computeReplay(rows: ReplayRows) {
  const rulesets = new Map<number, RuleSetParams>(
    rows.rulesets.map((r) => [
      r.version,
      ruleSetParamsSchema.parse(JSON.parse(r.params_json)) as RuleSetParams,
    ]),
  );
  const byBattle = new Map<string, ReplayRows['battles']>();
  for (const row of rows.battles) {
    const list = byBattle.get(row.id) ?? [];
    list.push(row);
    byBattle.set(row.id, list);
  }
  const events: RatingEvent[] = [];
  for (const [id, people] of byBattle) {
    const sorted = [...people].sort((a, b) => a.seat - b.seat);
    const [first] = sorted;
    if (!first) continue;
    const base = {
      id,
      formatId: first.format_id,
      timestamp: first.event_at,
      level: first.level as WeightLevel,
      rulesetVersion: first.ruleset_version,
    };
    // Group battles have a placement per person, single battles a score (services/rating.ts).
    if (sorted.length >= 2 && sorted.every((p) => p.placement !== null)) {
      events.push({
        ...base,
        scoring: 'placement',
        participants: sorted.map((p) => ({
          personId: p.user_id,
          placement: p.placement as number,
        })),
      });
    } else if (sorted.length === 2 && sorted.every((p) => p.score !== null)) {
      events.push({
        ...base,
        scoring: 'score',
        participants: sorted.map((p) => ({ personId: p.user_id, score: p.score as number })),
      });
    }
  }
  const formats: FormatInfo[] = rows.formats.map((f) => ({
    id: f.id,
    kPoints: f.k_points,
    mergedInto: f.merged_into,
  }));
  const estimates: Estimate[] = rows.estimates.map((e) => ({
    subjectId: e.subject_id,
    estimatorId: e.estimator_id,
    formatId: e.format_id,
    kind: e.kind,
    value: e.value,
    timestamp: e.created_at,
  }));
  const result = replay({ events, estimates, formats, rulesets });
  const rulesetOf = new Map(events.map((e) => [e.id, e.rulesetVersion]));
  return { ...result, rulesetOf };
}

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * SQL that replaces all derived rating data with the replay result and closes the given replay
 * requests. Meant for one `wrangler d1 execute --file` run (applied as one unit).
 */
export function replayStatements(
  result: ReturnType<typeof computeReplay>,
  requestIds: readonly string[],
  now: number,
): string[] {
  const statements = ['DELETE FROM rating_history;', 'DELETE FROM rating_states;'];
  // The state of a person in a format comes from their last event there.
  const lastEvent = new Map<string, string>();
  for (const h of result.history) {
    lastEvent.set(`${h.formatId}\u0000${h.personId}`, h.eventId);
    statements.push(
      `INSERT INTO rating_history (battle_id, user_id, format_id, event_at, r_before, rd_before, r_after, rd_after, sigma_after) VALUES (${[
        h.eventId,
        h.personId,
        h.formatId,
        h.timestamp,
        h.rBefore,
        h.rdBefore,
        h.rAfter,
        h.rdAfter,
        h.sigmaAfter,
      ]
        .map(sqlValue)
        .join(', ')});`,
    );
  }
  for (const s of result.states) {
    const eventId = lastEvent.get(`${s.formatId}\u0000${s.personId}`);
    const rulesetVersion = eventId ? result.rulesetOf.get(eventId) : undefined;
    if (rulesetVersion === undefined) continue; // no event in this format
    statements.push(
      `INSERT INTO rating_states (format_id, user_id, r, rd, sigma, last_event_at, n_battles, ruleset_version, computed_at) VALUES (${[
        s.formatId,
        s.personId,
        s.r,
        s.rd,
        s.sigma,
        s.lastEventAt,
        s.nBattles,
        rulesetVersion,
        now,
      ]
        .map(sqlValue)
        .join(', ')});`,
    );
  }
  for (const id of requestIds)
    statements.push(`UPDATE replay_requests SET done_at = ${now} WHERE id = ${sqlValue(id)};`);
  return statements;
}
