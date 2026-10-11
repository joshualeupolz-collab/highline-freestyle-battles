/**
 * Review level 1 (concept sections 7.1 and 7.5), without database access.
 *
 * Votes are values −2 … +2 seen from seat 0. Both on the same side = agreement: the battle is
 * decided. Anything else (different sides, or "can't decide" on either side) is no agreement:
 * both see the other vote and may change theirs. There is no draw in stage 1 (decided 2026-10-11).
 * When the review time is over, a single vote for one side decides; otherwise no result.
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
