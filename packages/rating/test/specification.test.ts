/**
 * Test values of rating specification section 11.
 * Parameters: σ = 0.06, τ = 0.5, weight 1, no protection rule. Values must match to ±1 point;
 * here we check that the rounded values are exactly the ones in the table.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_PARAMS, glicko2Update, rdEffective } from '../src';

const params = DEFAULT_RULESET_PARAMS;

function battle(rA: number, rdA: number, rB: number, rdB: number, sA: number, weight = 1) {
  const a = glicko2Update(
    { r: rA, rd: rdA, sigma: 0.06 },
    [{ r: rB, rd: rdB, score: sA, weight }],
    params,
  );
  const b = glicko2Update(
    { r: rB, rd: rdB, sigma: 0.06 },
    [{ r: rA, rd: rdA, score: 1 - sA, weight }],
    params,
  );
  return { deltaA: a.r - rA, rdA: a.rd, deltaB: b.r - rB };
}

describe('specification section 11', () => {
  it.each([
    // A r, A RD, B r, B RD, s(A), Δr A, new RD A, Δr B
    [1600, 60, 1500, 60, 1, 7, 60, -7],
    [1600, 60, 1500, 60, 0, -13, 60, 13],
    [1600, 200, 1500, 60, 1, 63, 176, -7],
    [3000, 50, 2000, 50, 0, -15, 51, 15],
    [3000, 176, 2000, 50, 0, -176, 176, 13],
    [3000, 176, 2000, 50, 1, 1, 176, 0],
    [3000, 176, 2000, 50, 0.25, -132, 176, 10],
  ])('%i±%i vs %i±%i, s(A) = %d', (rA, rdA, rB, rdB, sA, dA, newRdA, dB) => {
    const result = battle(rA, rdA, rB, rdB, sA);
    expect(Math.round(result.deltaA)).toBe(dA);
    expect(Math.round(result.rdA)).toBe(newRdA);
    // `+ 0` turns −0 into 0 for the "Δr B = 0" row.
    expect(Math.round(result.deltaB) + 0).toBe(dB);
  });

  it.each([
    [0.25, 2],
    [1, 7],
    [2, 14],
  ])('weight %d: 1600±60 beats 1500±60 → +%i', (weight, delta) => {
    expect(Math.round(battle(1600, 60, 1500, 60, 1, weight).deltaA)).toBe(delta);
  });

  it('inactivity: previous RD 50, 210 days inactive → RD_eff 176', () => {
    expect(Math.round(rdEffective(50, 210, params))).toBe(176);
  });

  it.each([
    [30, 50],
    [60, 57],
    [90, 75],
    [120, 98],
    [180, 150],
    [270, 231],
    [365, 319],
    [540, 350],
  ])('inactivity table (section 2.2): %i days → RD %i', (days, rd) => {
    expect(Math.round(rdEffective(50, days, params))).toBe(rd);
  });
});
