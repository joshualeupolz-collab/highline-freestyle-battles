/**
 * Display values and format rankings (rating specification sections 2.2 and 8.1).
 */
import type { RatingState } from './engine';
import { daysBetween, rdEffective } from './glicko2';
import type { RuleSetParams } from './params';

type DisplayParams = Pick<
  RuleSetParams,
  'graceDays' | 'cInact' | 'rdUnknown' | 'kDisplay' | 'provisionalRd' | 'minBattles'
>;

/** RD including inactivity at time `now` (milliseconds since the epoch). */
export function currentRd(state: RatingState, now: number, params: DisplayParams): number {
  if (state.lastEventAt === null) return state.rd;
  return rdEffective(state.rd, daysBetween(state.lastEventAt, now), params);
}

/** Ranking value R = r − K_DISPLAY · RD_eff. */
export function rankingValue(
  r: number,
  rdEff: number,
  params: Pick<RuleSetParams, 'kDisplay'>,
): number {
  return r - params.kDisplay * rdEff;
}

/** A rating is provisional ("?") if RD_eff > PROVISIONAL_RD or battles < MIN_BATTLES. */
export function isProvisional(
  rdEff: number,
  nBattles: number,
  params: Pick<RuleSetParams, 'provisionalRd' | 'minBattles'>,
): boolean {
  return rdEff > params.provisionalRd || nBattles < params.minBattles;
}

export interface RankingEntry {
  personId: string;
  r: number;
  /** Effective RD at the time of the ranking. */
  rd: number;
  rankingValue: number;
  nBattles: number;
  provisional: boolean;
}

/**
 * Ranking of one format at time `now`, best first. Provisional ratings are included.
 * Ties are broken by person id so the order is deterministic.
 */
export function formatRanking(
  states: readonly RatingState[],
  now: number,
  params: DisplayParams,
): RankingEntry[] {
  return states
    .map((state) => {
      const rd = currentRd(state, now, params);
      return {
        personId: state.personId,
        r: state.r,
        rd,
        rankingValue: rankingValue(state.r, rd, params),
        nBattles: state.nBattles,
        provisional: isProvisional(rd, state.nBattles, params),
      };
    })
    .sort((a, b) =>
      b.rankingValue !== a.rankingValue
        ? b.rankingValue - a.rankingValue
        : a.personId < b.personId
          ? -1
          : a.personId > b.personId
            ? 1
            : 0,
    );
}

// ---------------------------------------------------------------------------------------------
// Combined ranking (rating specification section 8.2)
// ---------------------------------------------------------------------------------------------

type ComboParams = Pick<RuleSetParams, 'comboMissingZ' | 'comboMinPop' | 'comboFallbackSd'>;

/**
 * Mean and spread of R in one format: over the non-provisional people; with fewer than
 * `comboMinPop` of them the spread is `comboFallbackSd` and the mean is over everyone.
 */
export function formatNormalization(
  entries: readonly RankingEntry[],
  params: ComboParams,
): { mean: number; sd: number } {
  const established = entries.filter((e) => !e.provisional).map((e) => e.rankingValue);
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / (values.length || 1);
  if (established.length < params.comboMinPop) {
    return { mean: mean(entries.map((e) => e.rankingValue)), sd: params.comboFallbackSd };
  }
  const m = mean(established);
  const variance = established.reduce((s, v) => s + (v - m) ** 2, 0) / established.length;
  const sd = Math.sqrt(variance);
  return { mean: m, sd: sd > 0 ? sd : params.comboFallbackSd };
}

/**
 * Combined value of one person: the X worst z-values are dropped (at least one value stays),
 * the rest is averaged. A missing format counts `missingZ`.
 */
export function combineZ(
  zValues: readonly (number | null)[],
  dropWorst: number,
  missingZ: number,
): number {
  const values = zValues.map((z) => z ?? missingZ).sort((a, b) => b - a);
  const kept = values.slice(0, Math.max(1, values.length - Math.max(0, dropWorst)));
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

export interface CombinedEntry {
  personId: string;
  /** Mean of the kept z-values. */
  value: number;
  /** z per format in the order of `formatIds` (null = never played). */
  z: (number | null)[];
  /** Formats the person has a rating in. */
  formatsPlayed: number;
}

/**
 * Combined ranking over several formats, best first. `rankings` holds the format ranking of
 * each format in `formatIds` (formatRanking). Only people with at least one real format appear.
 */
export function combinedRanking(
  formatIds: readonly string[],
  rankings: ReadonlyMap<string, readonly RankingEntry[]>,
  dropWorst: number,
  params: ComboParams,
): CombinedEntry[] {
  const byFormat = formatIds.map((id) => {
    const entries = rankings.get(id) ?? [];
    const { mean, sd } = formatNormalization(entries, params);
    return new Map(entries.map((e) => [e.personId, (e.rankingValue - mean) / sd]));
  });
  const people = new Set(byFormat.flatMap((m) => [...m.keys()]));
  return [...people]
    .map((personId) => {
      const z = byFormat.map((m) => m.get(personId) ?? null);
      return {
        personId,
        z,
        value: combineZ(z, dropWorst, params.comboMissingZ),
        formatsPlayed: z.filter((v) => v !== null).length,
      };
    })
    .sort((a, b) =>
      b.value !== a.value
        ? b.value - a.value
        : a.personId < b.personId
          ? -1
          : a.personId > b.personId
            ? 1
            : 0,
    );
}
