/**
 * Review rules (concept section 7), without database access. Level 1 first:
 *
 * Votes are values −2 … +2 seen from seat 0. Both on the same side = agreement: the battle is
 * decided. Anything else (different sides, or "can't decide" on either side) is no agreement:
 * both see the other vote and may change theirs. There is no draw in stage 1 (decided 2026-10-11).
 * When the review time is over, a single vote for one side decides, two votes without agreement
 * go to the pool (level 2, stage 2), and without votes the battle ends unrated.
 */
export type ReviewOutcome =
  | { kind: 'decided'; seat0Score: number }
  | { kind: 'open' }
  | { kind: 'no_agreement' };

/** s of seat 0 for one vote: 5-point scale 1 · 0.75 · 0.5 · 0.25 · 0, or 1 / 0 for win/loss. */
export function voteScore(value: number, scoring: string): number {
  if (scoring === 'win_loss') return value > 0 ? 1 : 0;
  return (value + 2) / 4;
}

/**
 * @param votes the level 1 votes (at most one per participant), seen from seat 0
 * @param closed the review time is over
 */
export function reviewOutcome(
  votes: readonly number[],
  scoring: string,
  closed: boolean,
): ReviewOutcome {
  const [a, b] = votes;
  if (votes.length === 2 && a !== undefined && b !== undefined && a * b > 0) {
    const mean = (voteScore(a, scoring) + voteScore(b, scoring)) / 2;
    return { kind: 'decided', seat0Score: mean };
  }
  if (!closed) return { kind: 'open' };
  if (votes.length === 1 && a !== undefined && a !== 0)
    return { kind: 'decided', seat0Score: voteScore(a, scoring) };
  return { kind: 'no_agreement' };
}

// ---------------------------------------------------------------------------------------------
// Level 2 – athlete pool, level 3 – judges (concept 7.2–7.3, decided by the owner 2026-10-12)
// ---------------------------------------------------------------------------------------------

/** Level 1 is no agreement once both voted (different sides, or "can't decide"). */
export function levelOneDisagrees(votes: readonly number[]): boolean {
  const [a, b] = votes;
  return votes.length === 2 && a !== undefined && b !== undefined && !(a * b > 0);
}

export type PoolOutcome =
  | { kind: 'open' }
  | { kind: 'decided'; seat0Score: number }
  | { kind: 'judges' };

/**
 * The pool decides when its reviews do not contradict each other: at least one sees a side
 * ahead and none sees the other side ahead ("can't decide" does not count against). s = mean of
 * all reviews ("can't decide" = 0.5). Reviews for both sides, or only "can't decide" → judges.
 */
export function poolOutcome(
  votes: readonly number[],
  scoring: string,
  poolSize: number,
): PoolOutcome {
  if (votes.length < poolSize) return { kind: 'open' };
  const forSeat0 = votes.some((v) => v > 0);
  const forSeat1 = votes.some((v) => v < 0);
  if (forSeat0 === forSeat1) return { kind: 'judges' };
  if (scoring === 'win_loss') return { kind: 'decided', seat0Score: forSeat0 ? 1 : 0 };
  const mean = votes.reduce((sum, v) => sum + (v + 2) / 4, 0) / votes.length;
  return { kind: 'decided', seat0Score: mean };
}

/** Rating range of the pool at a time (null max = no upper limit). */
export function poolWindow(
  rHigh: number,
  since: number,
  now: number,
  p: {
    windowBelow: number;
    windowAbove: number;
    widenAfterHours: number;
    widenedAbove: number;
    openAfterDays: number;
    openBelow: number;
  },
): { min: number; max: number | null } {
  const elapsed = now - since;
  if (elapsed >= p.openAfterDays * 86_400_000) return { min: rHigh - p.openBelow, max: null };
  if (elapsed >= p.widenAfterHours * 3_600_000)
    return { min: rHigh - p.windowBelow, max: rHigh + p.widenedAbove };
  return { min: rHigh - p.windowBelow, max: rHigh + p.windowAbove };
}
