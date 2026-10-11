/**
 * Rating parameters of one RuleSet version (rating specification section 1).
 *
 * Every number of the rating system lives here, so a rule change is a new RuleSet version
 * and never a code change. The names mirror the specification in camelCase.
 */

/** Battle weight level 1 (fun) … 5 (official competition), see specification section 4. */
export type WeightLevel = 1 | 2 | 3 | 4 | 5;

/** Protection rule, see specification section 2.3. */
export type ClampMode = 'winner' | 'both' | 'none';

export interface RuleSetParams {
  /** `R_DEFAULT`: rating without any initial estimate. */
  rDefault: number;
  /** `SCALE`: Glicko-2 conversion factor (400 / ln 10). Fixed. */
  scale: number;
  /** `TAU`: system constant for volatility. */
  tau: number;
  /** `SIGMA_START`: initial volatility. */
  sigmaStart: number;
  /** `RD_UNKNOWN`: uncertainty without initial estimate, also the upper limit of RD. */
  rdUnknown: number;
  /** `RD_START`: uncertainty after an initial estimate. */
  rdStart: number;
  /** `GRACE_DAYS`: days without any inactivity effect. */
  graceDays: number;
  /** `C_INACT`: growth rate of uncertainty during inactivity. */
  cInact: number;
  /** `K_DISPLAY`: ranking value = r − kDisplay · RD_eff. */
  kDisplay: number;
  /** `PROVISIONAL_RD`: above this RD a rating is provisional ("?"). */
  provisionalRd: number;
  /** `MIN_BATTLES`: below this number of battles a rating is provisional ("?"). */
  minBattles: number;
  /** `WEIGHT`: factor per weight level. */
  weights: Record<WeightLevel, number>;
  /** `K_POINTS`: default exponent for points → score; a format can override it. */
  kPoints: number;
  /** `CLAMP`: protection rule. */
  clamp: ClampMode;
  /** `COMBO_MISSING_Z`: value of a missing format in combined rankings. */
  comboMissingZ: number;
  /** `COMBO_MIN_POP`: minimum number of established people for a format's own spread. */
  comboMinPop: number;
  /** `COMBO_FALLBACK_SD`: fallback spread for small formats. */
  comboFallbackSd: number;
  /** `OVERRATE_Z`: threshold for the over-rating warning. */
  overrateZ: number;
  /** Convergence tolerance of the volatility iteration (ε in the specification). */
  volatilityEpsilon: number;
}

/** RuleSet version 1: the initial values of rating specification section 1. */
export const DEFAULT_RULESET_PARAMS: Readonly<RuleSetParams> = Object.freeze({
  rDefault: 1500,
  scale: 173.7178,
  tau: 0.5,
  sigmaStart: 0.06,
  rdUnknown: 350,
  rdStart: 200,
  graceDays: 30,
  cInact: 0.94,
  kDisplay: 2.0,
  provisionalRd: 110,
  minBattles: 5,
  weights: Object.freeze({ 1: 0.25, 2: 0.5, 3: 1.0, 4: 1.5, 5: 2.0 }),
  kPoints: 2.0,
  clamp: 'winner',
  comboMissingZ: -1.0,
  comboMinPop: 10,
  comboFallbackSd: 250,
  overrateZ: -3.0,
  volatilityEpsilon: 1e-6,
});

export function isWeightLevel(value: number): value is WeightLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}
