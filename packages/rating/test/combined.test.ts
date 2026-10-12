import { describe, expect, it } from 'vitest';
import { combinedRanking, combineZ, DEFAULT_RULESET_PARAMS, type RankingEntry } from '../src';

const params = DEFAULT_RULESET_PARAMS;

describe('combined ranking (specification section 8.2)', () => {
  it('reproduces the worked example', () => {
    // z per format; null = never played. Expected values for X = 0, 1, 2 from the table.
    const rows: [string, (number | null)[], number[]][] = [
      ['Anna', [1.12, 1.05, 0.97], [1.05, 1.09, 1.12]],
      ['Ben', [null, null, 2.77], [0.26, 0.89, 2.77]],
      ['Carla', [1.52, 1.9, null], [0.81, 1.71, 1.9]],
      ['David', [1.36, 1.2, 1.3], [1.29, 1.33, 1.36]],
      ['Emil', [-0.4, -1.0, -0.5], [-0.63, -0.45, -0.4]],
    ];
    // The table is rounded to two decimals.
    for (const [, z, expected] of rows)
      for (const [x, value] of expected.entries())
        expect(Math.abs(combineZ(z, x, params.comboMissingZ) - value)).toBeLessThanOrEqual(0.006);
  });

  it('keeps at least one value when more formats are dropped than played', () => {
    expect(combineZ([0.5, null], 5, -1)).toBe(0.5);
  });

  it('normalizes per format and needs at least one real format', () => {
    const entry = (personId: string, rankingValue: number): RankingEntry => ({
      personId,
      r: rankingValue,
      rd: 50,
      rankingValue,
      nBattles: 20,
      provisional: false,
    });
    // Few established people: fallback spread 250 around the mean of everyone.
    const rankings = new Map([
      ['a', [entry('p1', 1750), entry('p2', 1500), entry('p3', 1250)]],
      ['b', [entry('p1', 1500), entry('p4', 1500)]],
    ]);
    const result = combinedRanking(['a', 'b'], rankings, 0, params);
    // p2 and p4 both average 0 and the missing −1; ties go by id.
    expect(result.map((r) => r.personId)).toEqual(['p1', 'p2', 'p4', 'p3']);
    const p1 = result.find((r) => r.personId === 'p1');
    expect(p1?.z).toEqual([1, 0]);
    expect(p1?.value).toBeCloseTo(0.5);
    const p4 = result.find((r) => r.personId === 'p4');
    expect(p4).toMatchObject({ z: [null, 0], formatsPlayed: 1 });
    expect(p4?.value).toBeCloseTo(-0.5); // missing format counts −1
  });
});
