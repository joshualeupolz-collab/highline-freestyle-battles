/**
 * Weighted Glicko-2 core (rating specification section 2).
 *
 * This is a direct port of `glicko2_update`, `new_sigma`, `rd_effective` and `clamp_delta`
 * in `rating/glicko_sim.py`. Keep both in sync: the Python file is the reference.
 */
import type { ClampMode, RuleSetParams } from './params';

/** Centre of the Glicko-2 conversion μ = (r − 1500) / SCALE. Fixed by the algorithm. */
const GLICKO_CENTER = 1500;
const MS_PER_DAY = 86_400_000;

export interface Glicko2Rating {
  r: number;
  rd: number;
  sigma: number;
}

/** One comparison against an opponent inside an event. */
export interface Comparison {
  /** Opponent rating before the event. */
  r: number;
  /** Opponent effective RD (`RD_eff`) before the event. */
  rd: number;
  /** Score of the person being updated, 0 … 1. */
  score: number;
  /** Weight of this comparison; weight 2 counts like two identical battles. */
  weight: number;
}

type CoreParams = Pick<RuleSetParams, 'scale' | 'tau' | 'volatilityEpsilon'>;

export function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Expected score of a player rated `r` against an opponent `rOpp ± rdOpp`. */
export function expectedScore(r: number, rOpp: number, rdOpp: number, scale: number): number {
  const mu = (r - GLICKO_CENTER) / scale;
  const muJ = (rOpp - GLICKO_CENTER) / scale;
  return 1 / (1 + Math.exp(-g(rdOpp / scale) * (mu - muJ)));
}

/** New volatility σ' using Glickman's iteration (Illinois method). */
export function newSigma(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
  tau: number,
  eps: number,
): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phi * phi + v + ex;
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * denom * denom) - (x - a) / (tau * tau)
    );
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > eps) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * Updates one person with all comparisons of one event at once.
 * `rating.rd` must already be the effective RD (`RD_eff`) at the time of the event.
 */
export function glicko2Update(
  rating: Glicko2Rating,
  comparisons: readonly Comparison[],
  params: CoreParams,
): Glicko2Rating {
  if (comparisons.length === 0) {
    return { ...rating };
  }
  const { scale } = params;
  const mu = (rating.r - GLICKO_CENTER) / scale;
  const phi = rating.rd / scale;

  let vInv = 0;
  let dSum = 0;
  for (const c of comparisons) {
    const muJ = (c.r - GLICKO_CENTER) / scale;
    const gJ = g(c.rd / scale);
    const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
    vInv += c.weight * gJ * gJ * e * (1 - e);
    dSum += c.weight * gJ * (c.score - e);
  }
  if (vInv < 1e-12) {
    return { ...rating };
  }

  const v = 1 / vInv;
  const sigma = newSigma(rating.sigma, phi, v, v * dSum, params.tau, params.volatilityEpsilon);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * dSum;
  return { r: GLICKO_CENTER + scale * muNew, rd: scale * phiNew, sigma };
}

/** Effective RD after `daysInactive` days without a battle (specification section 2.2). */
export function rdEffective(
  rd: number,
  daysInactive: number,
  params: Pick<RuleSetParams, 'graceDays' | 'cInact' | 'rdUnknown'>,
): number {
  const t = Math.max(0, daysInactive - params.graceDays);
  return Math.min(params.rdUnknown, Math.sqrt(rd * rd + (params.cInact * t) ** 2));
}

/** Days between two timestamps in milliseconds. */
export function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / MS_PER_DAY;
}

/**
 * Protection rule (specification section 2.3).
 * `outcome` = Σ w · (s − 0.5) of the person in this event: > 0 won, < 0 lost.
 */
export function applyClamp(rOld: number, rNew: number, outcome: number, mode: ClampMode): number {
  if ((mode === 'winner' || mode === 'both') && outcome > 0 && rNew < rOld) {
    return rOld;
  }
  if (mode === 'both' && outcome < 0 && rNew > rOld) {
    return rOld;
  }
  return rNew;
}
