/**
 * Rating values as shown to people: effective RD (with inactivity), ranking value r − 2·RD and
 * the provisional "?" flag (rating specification §8.1), computed by the rating engine.
 */
import {
  currentRd,
  isProvisional,
  type RatingState,
  type RuleSetParams,
  rankingValue,
} from '@hfb/rating';
import type { Database } from '../db/client';
import type { ratingStates } from '../db/schema';
import { currentRuleset, parseRulesetParams } from '../routes/rulesets';

type StateRow = typeof ratingStates.$inferSelect;

export interface RatingView {
  r: number;
  rd: number;
  rankingValue: number;
  provisional: boolean;
  nBattles: number;
  lastEventAt: number | null;
}

export async function displayParams(db: Database): Promise<RuleSetParams> {
  const row = await currentRuleset(db);
  if (!row) throw new Error('No RuleSet configured');
  return parseRulesetParams(row);
}

export function toEngineState(row: StateRow): RatingState {
  return {
    personId: row.userId,
    formatId: row.formatId,
    r: row.r,
    rd: row.rd,
    sigma: row.sigma,
    lastEventAt: row.lastEventAt,
    nBattles: row.nBattles,
  };
}

export function ratingView(row: StateRow, params: RuleSetParams, now = Date.now()): RatingView {
  const rd = currentRd(toEngineState(row), now, params);
  return {
    r: Math.round(row.r),
    rd: Math.round(rd),
    rankingValue: Math.round(rankingValue(row.r, rd, params)),
    provisional: isProvisional(rd, row.nBattles, params),
    nBattles: row.nBattles,
    lastEventAt: row.lastEventAt,
  };
}
