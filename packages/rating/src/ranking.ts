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
