/**
 * Conversion of battle results into a score s ∈ [0, 1] (rating specification section 3).
 * The score of the other side is always 1 − s.
 */

/** Points a : b → s = a^k / (a^k + b^k). If both are 0, s = 0.5. */
export function scoreFromPoints(a: number, b: number, k: number): number {
  if (a + b === 0) {
    return 0.5;
  }
  const ak = a ** k;
  return ak / (ak + b ** k);
}

/** Placements (lower is better): better = 1, equal = 0.5, worse = 0. */
export function scoreFromPlacement(placementA: number, placementB: number): number {
  if (placementA < placementB) return 1;
  if (placementA > placementB) return 0;
  return 0.5;
}

/**
 * 5-point scale vote, seen from side A:
 * +2 A clearly better · +1 A somewhat better · 0 can't decide · −1 B somewhat better · −2 B clearly better.
 * Returns s(A): 1 · 0.75 · 0.5 · 0.25 · 0.
 */
export function scoreFromScaleVote(vote: -2 | -1 | 0 | 1 | 2): number {
  return (vote + 2) / 4;
}
