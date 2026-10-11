/**
 * Rating engine: turns events, initial estimates and RuleSets into RatingState and RatingHistory.
 *
 * Pure module: no database, no network, no clock. The same input always gives the same output,
 * so ratings can be recalculated from the raw data at any time (rating specification §0, §2.1).
 *
 * Two ways to use it:
 * - `replay(...)`: full recalculation of the whole history (background job).
 * - `new RatingEngine(...)` with the current states, then `apply(event)`: incremental update
 *   of a single new event (API). Both share the same code path, so they give identical results.
 */

import { compareEvents, expandEvent, type RatingEvent, RatingInputError } from './events';
import {
  applyClamp,
  type Comparison,
  daysBetween,
  type Glicko2Rating,
  glicko2Update,
  rdEffective,
} from './glicko2';
import type { RuleSetParams } from './params';

/** Who gave an initial estimate (specification section 6.1). */
export type EstimateKind = 'admin' | 'federation' | 'athlete';

export interface Estimate {
  subjectId: string;
  estimatorId: string;
  formatId: string;
  kind: EstimateKind;
  value: number;
  timestamp: number;
}

export interface FormatInfo {
  id: string;
  /** Format-specific exponent for points → score; falls back to the RuleSet's `kPoints`. */
  kPoints?: number | null;
  /** If set, all battles of this format count as battles of the target format (§7). */
  mergedInto?: string | null;
}

/** Derived rating of one person in one format. The RD is stored without inactivity. */
export interface RatingState {
  personId: string;
  formatId: string;
  r: number;
  rd: number;
  sigma: number;
  /** Timestamp of the last event in this format, `null` if the person has no event yet. */
  lastEventAt: number | null;
  nBattles: number;
}

/** One person's change through one event, e.g. for the "+12" display. */
export interface RatingHistoryEntry {
  eventId: string;
  personId: string;
  formatId: string;
  timestamp: number;
  rBefore: number;
  /** Effective RD (including inactivity) the update started from. */
  rdBefore: number;
  sigmaBefore: number;
  rAfter: number;
  rdAfter: number;
  sigmaAfter: number;
}

export interface EngineOptions {
  /** RuleSet parameters per version. */
  rulesets: ReadonlyMap<number, RuleSetParams> | Readonly<Record<number, RuleSetParams>>;
  formats?: readonly FormatInfo[];
  /**
   * Initial estimates that apply. Used only for people who have no state yet in a format.
   * `replay` filters them by the "fewer than MIN_BATTLES battles" rule itself.
   */
  estimates?: readonly Estimate[];
  /** Existing states to continue from (incremental mode). */
  initialStates?: readonly RatingState[];
}

/** Raised when an event is older than the last event of one of its participants. */
export class OutOfOrderEventError extends RatingInputError {
  override name = 'OutOfOrderEventError';
}

export class RatingEngine {
  private readonly rulesets: ReadonlyMap<number, RuleSetParams>;
  private readonly formats: ReadonlyMap<string, FormatInfo>;
  private readonly estimates = new Map<string, Estimate[]>();
  private readonly states = new Map<string, RatingState>();

  constructor(options: EngineOptions) {
    this.rulesets = toRulesetMap(options.rulesets);
    this.formats = new Map((options.formats ?? []).map((f) => [f.id, f]));
    for (const estimate of options.estimates ?? []) {
      const key = stateKey(estimate.subjectId, this.ratingFormatOf(estimate.formatId));
      const list = this.estimates.get(key) ?? [];
      list.push(estimate);
      this.estimates.set(key, list);
    }
    for (const state of options.initialStates ?? []) {
      this.states.set(stateKey(state.personId, state.formatId), { ...state });
    }
  }

  /** The format whose rating an event of `formatId` counts for (follows `mergedInto`). */
  ratingFormatOf(formatId: string): string {
    return resolveRatingFormat(this.formats, formatId);
  }

  /** Current stored state, or `undefined` if the person has no event in that format yet. */
  getState(personId: string, formatId: string): RatingState | undefined {
    const state = this.states.get(stateKey(personId, this.ratingFormatOf(formatId)));
    return state ? { ...state } : undefined;
  }

  getStates(): RatingState[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  /**
   * Applies one event. All participants are updated simultaneously from their values before
   * the event (specification section 2.1). Returns one history entry per participant.
   */
  apply(event: RatingEvent): RatingHistoryEntry[] {
    const params = this.rulesets.get(event.rulesetVersion);
    if (!params) {
      throw new RatingInputError(
        `Event ${event.id}: unknown RuleSet version ${event.rulesetVersion}`,
      );
    }
    const formatId = this.ratingFormatOf(event.formatId);
    const kPoints = this.formats.get(event.formatId)?.kPoints ?? params.kPoints;
    const comparisons = expandEvent(event, params.weights[event.level], kPoints);

    // Values before the event, with inactivity applied to the RD.
    const before = new Map<string, { state: RatingState; effective: Glicko2Rating }>();
    for (const personId of comparisons.keys()) {
      const state =
        this.states.get(stateKey(personId, formatId)) ?? this.newState(personId, formatId, params);
      if (state.lastEventAt !== null && event.timestamp < state.lastEventAt) {
        throw new OutOfOrderEventError(
          `Event ${event.id} is older than the last event of ${personId} in ${formatId}; a replay is needed`,
        );
      }
      const rd =
        state.lastEventAt === null
          ? state.rd
          : rdEffective(state.rd, daysBetween(state.lastEventAt, event.timestamp), params);
      before.set(personId, { state, effective: { r: state.r, rd, sigma: state.sigma } });
    }

    const history: RatingHistoryEntry[] = [];
    const updated: RatingState[] = [];
    for (const [personId, pairs] of comparisons) {
      const own = before.get(personId);
      if (!own) continue;
      const games: Comparison[] = pairs.map((pair) => {
        const opponent = before.get(pair.opponentId)?.effective as Glicko2Rating;
        return { r: opponent.r, rd: opponent.rd, score: pair.score, weight: pair.weight };
      });
      const next = glicko2Update(own.effective, games, params);
      const outcome = games.reduce((sum, c) => sum + c.weight * (c.score - 0.5), 0);
      const rAfter = applyClamp(own.effective.r, next.r, outcome, params.clamp);

      updated.push({
        personId,
        formatId,
        r: rAfter,
        rd: next.rd,
        sigma: next.sigma,
        lastEventAt: event.timestamp,
        nBattles: own.state.nBattles + 1,
      });
      history.push({
        eventId: event.id,
        personId,
        formatId,
        timestamp: event.timestamp,
        rBefore: own.effective.r,
        rdBefore: own.effective.rd,
        sigmaBefore: own.effective.sigma,
        rAfter,
        rdAfter: next.rd,
        sigmaAfter: next.sigma,
      });
    }
    for (const state of updated) {
      this.states.set(stateKey(state.personId, state.formatId), state);
    }
    return history;
  }

  /** Starting values from initial estimates (specification section 6.1). */
  private newState(personId: string, formatId: string, params: RuleSetParams): RatingState {
    const start = initialRating(this.estimates.get(stateKey(personId, formatId)) ?? [], params);
    return {
      personId,
      formatId,
      r: start.r,
      rd: start.rd,
      sigma: params.sigmaStart,
      lastEventAt: null,
      nBattles: 0,
    };
  }
}

/**
 * Starting rating from the applicable estimates of one person in one format:
 * the latest admin/federation estimate wins; otherwise the median of the athletes' estimates
 * (latest per estimator) if there are at least 3; otherwise the default.
 */
export function initialRating(
  estimates: readonly Estimate[],
  params: Pick<RuleSetParams, 'rDefault' | 'rdUnknown' | 'rdStart'>,
): { r: number; rd: number } {
  let official: Estimate | undefined;
  const latestPerAthlete = new Map<string, Estimate>();
  for (const e of estimates) {
    if (e.kind === 'athlete') {
      const previous = latestPerAthlete.get(e.estimatorId);
      if (!previous || e.timestamp >= previous.timestamp) latestPerAthlete.set(e.estimatorId, e);
    } else if (!official || e.timestamp >= official.timestamp) {
      official = e;
    }
  }
  if (official) return { r: official.value, rd: params.rdStart };
  if (latestPerAthlete.size >= 3) {
    return { r: median([...latestPerAthlete.values()].map((e) => e.value)), rd: params.rdStart };
  }
  return { r: params.rDefault, rd: params.rdUnknown };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export interface ReplayInput {
  events: readonly RatingEvent[];
  estimates?: readonly Estimate[];
  formats?: readonly FormatInfo[];
  rulesets: EngineOptions['rulesets'];
}

export interface ReplayResult {
  states: RatingState[];
  history: RatingHistoryEntry[];
}

/**
 * Full recalculation from the raw data. The caller passes only events that count
 * (decided, approved, not annulled) and estimates that were not withdrawn.
 *
 * An estimate applies if the person had fewer than `minBattles` events in that format before
 * the estimate was given. It then defines the starting value retroactively.
 */
export function replay(input: ReplayInput): ReplayResult {
  const events = [...input.events].sort(compareEvents);
  const rulesets = toRulesetMap(input.rulesets);
  const formats = new Map((input.formats ?? []).map((f) => [f.id, f]));

  // Each person's events per rating format, in replay order.
  const timeline = new Map<string, RatingEvent[]>();
  for (const event of events) {
    const formatId = resolveRatingFormat(formats, event.formatId);
    for (const p of event.participants) {
      const key = stateKey(p.personId, formatId);
      const list = timeline.get(key) ?? [];
      list.push(event);
      timeline.set(key, list);
    }
  }

  const applicable = (input.estimates ?? []).filter((estimate) => {
    const key = stateKey(estimate.subjectId, resolveRatingFormat(formats, estimate.formatId));
    const own = timeline.get(key);
    if (!own?.[0]) return false; // no battle in this format: the estimate has no effect yet
    const minBattles = rulesets.get(own[0].rulesetVersion)?.minBattles ?? 0;
    const battlesBefore = own.filter((e) => e.timestamp < estimate.timestamp).length;
    return battlesBefore < minBattles;
  });

  const engine = new RatingEngine({
    rulesets,
    formats: input.formats ?? [],
    estimates: applicable,
  });
  const history: RatingHistoryEntry[] = [];
  for (const event of events) {
    history.push(...engine.apply(event));
  }
  return { states: engine.getStates(), history };
}

function toRulesetMap(rulesets: EngineOptions['rulesets']): ReadonlyMap<number, RuleSetParams> {
  return rulesets instanceof Map
    ? rulesets
    : new Map(Object.entries(rulesets).map(([version, params]) => [Number(version), params]));
}

/** Follows `mergedInto` to the format whose rating an event counts for. */
function resolveRatingFormat(formats: ReadonlyMap<string, FormatInfo>, formatId: string): string {
  let current = formatId;
  const seen = new Set<string>();
  for (;;) {
    const target = formats.get(current)?.mergedInto;
    if (!target) return current;
    if (seen.has(current)) {
      throw new RatingInputError(`Format merge cycle involving ${formatId}`);
    }
    seen.add(current);
    current = target;
  }
}

function stateKey(personId: string, formatId: string): string {
  return `${formatId}\u0000${personId}`;
}
