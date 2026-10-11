import { describe, expect, it } from 'vitest';
import {
  applyClamp,
  DEFAULT_RULESET_PARAMS,
  type Estimate,
  expandEvent,
  formatRanking,
  initialRating,
  OutOfOrderEventError,
  RatingEngine,
  type RatingEvent,
  RatingInputError,
  replay,
  scoreFromPlacement,
  scoreFromPoints,
  scoreFromScaleVote,
} from '../src';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const rulesets = { 1: DEFAULT_RULESET_PARAMS };

function single(
  id: string,
  a: string,
  b: string,
  scoreA: number,
  timestamp = T0,
  level: RatingEvent['level'] = 3,
): RatingEvent {
  return {
    id,
    formatId: 'f',
    timestamp,
    level,
    rulesetVersion: 1,
    scoring: 'score',
    participants: [
      { personId: a, score: scoreA },
      { personId: b, score: 1 - scoreA },
    ],
  };
}

describe('score conversion (section 3)', () => {
  it('converts points with k = 2 as in the examples', () => {
    expect(scoreFromPoints(100, 90, 2)).toBeCloseTo(0.55, 2);
    expect(scoreFromPoints(150, 80, 2)).toBeCloseTo(0.78, 2);
    expect(scoreFromPoints(200, 50, 2)).toBeCloseTo(0.94, 2);
    expect(scoreFromPoints(120, 0, 2)).toBe(1);
    expect(scoreFromPoints(0, 0, 2)).toBe(0.5);
  });

  it('converts placements and 5-point scale votes', () => {
    expect(scoreFromPlacement(1, 2)).toBe(1);
    expect(scoreFromPlacement(2, 2)).toBe(0.5);
    expect(scoreFromPlacement(3, 2)).toBe(0);
    expect([2, 1, 0, -1, -2].map((v) => scoreFromScaleVote(v as -2 | -1 | 0 | 1 | 2))).toEqual([
      1, 0.75, 0.5, 0.25, 0,
    ]);
  });
});

describe('group battles (section 5.1)', () => {
  it('splits 4 people into 6 pairs, each person gets 3 comparisons of weight 1/3', () => {
    const event: RatingEvent = {
      id: 'g',
      formatId: 'f',
      timestamp: T0,
      level: 3,
      rulesetVersion: 1,
      scoring: 'placement',
      participants: ['a', 'b', 'c', 'd'].map((personId, i) => ({ personId, placement: i + 1 })),
    };
    const pairs = expandEvent(event, 1, 2);
    for (const list of pairs.values()) {
      expect(list).toHaveLength(3);
      expect(list.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 12);
    }
    expect(pairs.get('a')?.map((c) => c.score)).toEqual([1, 1, 1]);
    expect(pairs.get('d')?.map((c) => c.score)).toEqual([0, 0, 0]);
  });

  it('counts a group battle as one battle for every participant', () => {
    const engine = new RatingEngine({ rulesets });
    engine.apply({
      id: 'g',
      formatId: 'f',
      timestamp: T0,
      level: 3,
      rulesetVersion: 1,
      scoring: 'points',
      participants: [
        { personId: 'a', points: 30 },
        { personId: 'b', points: 20 },
        { personId: 'c', points: 10 },
      ],
    });
    expect(engine.getStates().map((s) => s.nBattles)).toEqual([1, 1, 1]);
  });
});

describe('protection rule (section 2.3)', () => {
  it('keeps the old rating of a winner, and of a loser only with CLAMP=both', () => {
    expect(applyClamp(1500, 1490, 0.5, 'winner')).toBe(1500);
    expect(applyClamp(1500, 1490, 0.5, 'none')).toBe(1490);
    expect(applyClamp(1500, 1510, -0.5, 'winner')).toBe(1510);
    expect(applyClamp(1500, 1510, -0.5, 'both')).toBe(1500);
  });

  it('a strong but uncertain player who barely wins does not lose points', () => {
    // 3000±176 beats 2000±50: without the rule this is about −0.6 … +0.6, never negative with it.
    const engine = new RatingEngine({
      rulesets,
      initialStates: [
        {
          personId: 'a',
          formatId: 'f',
          r: 3000,
          rd: 50,
          sigma: 0.06,
          lastEventAt: T0 - 210 * DAY,
          nBattles: 20,
        },
        {
          personId: 'b',
          formatId: 'f',
          r: 2000,
          rd: 50,
          sigma: 0.06,
          lastEventAt: T0,
          nBattles: 20,
        },
      ],
    });
    const [a] = engine.apply(single('e', 'a', 'b', 0.75, T0));
    expect(a?.rAfter).toBeGreaterThanOrEqual(3000);
  });
});

describe('RatingEngine', () => {
  it('updates both sides simultaneously from their values before the event', () => {
    const engine = new RatingEngine({ rulesets });
    const history = engine.apply(single('e1', 'a', 'b', 1));
    expect(history.map((h) => [h.personId, h.rBefore, h.rdBefore])).toEqual([
      ['a', 1500, 350],
      ['b', 1500, 350],
    ]);
    const [a, b] = history;
    expect((a?.rAfter ?? 0) - 1500).toBeCloseTo(1500 - (b?.rAfter ?? 0), 9);
  });

  it('applies inactivity to the RD but never to the rating', () => {
    const engine = new RatingEngine({ rulesets });
    engine.apply(single('e1', 'a', 'b', 1, T0));
    const after = engine.getState('a', 'f');
    const [entry] = engine.apply(single('e2', 'a', 'c', 0.5, T0 + 210 * DAY));
    expect(entry?.rBefore).toBe(after?.r);
    expect(entry?.rdBefore).toBeGreaterThan(after?.rd ?? Number.POSITIVE_INFINITY);
  });

  it('rejects an event older than the last event of a participant', () => {
    const engine = new RatingEngine({ rulesets });
    engine.apply(single('e1', 'a', 'b', 1, T0 + DAY));
    expect(() => engine.apply(single('e2', 'a', 'c', 1, T0))).toThrow(OutOfOrderEventError);
  });

  it('rejects invalid events', () => {
    const engine = new RatingEngine({ rulesets });
    expect(() => engine.apply(single('x', 'a', 'a', 1))).toThrow(RatingInputError);
    expect(() => engine.apply(single('x', 'a', 'b', 1.5))).toThrow(RatingInputError);
    expect(() => engine.apply({ ...single('x', 'a', 'b', 1), level: 6 as never })).toThrow(
      RatingInputError,
    );
    expect(() => engine.apply({ ...single('x', 'a', 'b', 1), rulesetVersion: 99 })).toThrow(
      /RuleSet/,
    );
    expect(() =>
      engine.apply({
        ...single('x', 'a', 'b', 1),
        participants: [
          { personId: 'a', score: 1 },
          { personId: 'b', score: 1 },
        ],
      }),
    ).toThrow(/add up to 1/);
  });

  it('gives the same result incrementally as in a full replay', () => {
    const events = [
      single('e1', 'a', 'b', 1, T0),
      single('e2', 'b', 'c', 0.25, T0 + 3 * DAY, 5),
      single('e3', 'a', 'c', 0, T0 + 100 * DAY, 1),
    ];
    const full = replay({ events, rulesets });

    let states = new RatingEngine({ rulesets }).getStates();
    for (const event of events) {
      // Simulates the API: load the stored states, apply one event, store the states again.
      const engine = new RatingEngine({ rulesets, initialStates: states });
      engine.apply(event);
      states = engine.getStates();
    }
    const byKey = (list: typeof states) => Object.fromEntries(list.map((s) => [s.personId, s]));
    expect(byKey(states)).toEqual(byKey(full.states));
  });

  it('counts battles of a merged format for the target format and uses its own kPoints', () => {
    const formats = [{ id: 'old', mergedInto: 'f', kPoints: 1 }, { id: 'f' }];
    const event: RatingEvent = {
      id: 'e',
      formatId: 'old',
      timestamp: T0,
      level: 3,
      rulesetVersion: 1,
      scoring: 'points',
      participants: [
        { personId: 'a', points: 3 },
        { personId: 'b', points: 1 },
      ],
    };
    const { states, history } = replay({ events: [event], formats, rulesets });
    expect(states.map((s) => s.formatId)).toEqual(['f', 'f']);
    // k = 1 → s = 3 / 4; with the default k = 2 it would be 0.9.
    const withK1 = replay({
      events: [{ ...event, formatId: 'f' }],
      formats: [{ id: 'f', kPoints: 1 }],
      rulesets,
    });
    expect(history[0]?.rAfter).toBeCloseTo(withK1.history[0]?.rAfter ?? 0, 9);
  });

  it('detects merge cycles', () => {
    const engine = new RatingEngine({
      rulesets,
      formats: [
        { id: 'x', mergedInto: 'y' },
        { id: 'y', mergedInto: 'x' },
      ],
    });
    expect(() => engine.ratingFormatOf('x')).toThrow(/cycle/);
  });
});

describe('initial estimates (section 6.1)', () => {
  const estimate = (
    estimatorId: string,
    value: number,
    kind: Estimate['kind'] = 'athlete',
    timestamp = T0,
  ): Estimate => ({
    subjectId: 'a',
    estimatorId,
    formatId: 'f',
    kind,
    value,
    timestamp,
  });

  it('uses the default without enough estimates', () => {
    expect(
      initialRating([estimate('x', 1800), estimate('y', 1900)], DEFAULT_RULESET_PARAMS),
    ).toEqual({ r: 1500, rd: 350 });
  });

  it('uses the median of at least 3 athletes, the latest estimate per athlete counts', () => {
    const list = [
      estimate('x', 1800),
      estimate('y', 1900),
      estimate('z', 2400),
      estimate('x', 2000, 'athlete', T0 + DAY),
    ];
    expect(initialRating(list, DEFAULT_RULESET_PARAMS)).toEqual({ r: 2000, rd: 200 });
  });

  it('prefers the latest admin or federation estimate', () => {
    const list = [
      estimate('x', 1800),
      estimate('y', 1900),
      estimate('z', 2400),
      estimate('adm', 1700, 'admin'),
      estimate('fed', 1650, 'federation', T0 + DAY),
    ];
    expect(initialRating(list, DEFAULT_RULESET_PARAMS)).toEqual({ r: 1650, rd: 200 });
  });

  it('applies an estimate retroactively only while the person has fewer than MIN_BATTLES battles', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      single(`e${i}`, 'a', `opp${i}`, 1, T0 + i * DAY),
    );
    const late = replay({
      events,
      estimates: [estimate('adm', 2000, 'admin', T0 + 2.5 * DAY)],
      rulesets,
    });
    expect(late.history[0]?.rBefore).toBe(2000);
    const tooLate = replay({
      events,
      estimates: [estimate('adm', 2000, 'admin', T0 + 5.5 * DAY)],
      rulesets,
    });
    expect(tooLate.history[0]?.rBefore).toBe(1500);
  });
});

describe('format ranking (section 8.1)', () => {
  it('sorts by r − 2·RD_eff and marks provisional ratings', () => {
    const base = { formatId: 'f', sigma: 0.06, lastEventAt: T0 };
    const ranking = formatRanking(
      [
        { ...base, personId: 'steady', r: 1800, rd: 50, nBattles: 30 },
        { ...base, personId: 'newcomer', r: 1900, rd: 200, nBattles: 2 },
        { ...base, personId: 'away', r: 2000, rd: 50, nBattles: 30, lastEventAt: T0 - 365 * DAY },
      ],
      T0,
      DEFAULT_RULESET_PARAMS,
    );
    expect(ranking.map((e) => e.personId)).toEqual(['steady', 'newcomer', 'away']);
    expect(ranking.map((e) => e.provisional)).toEqual([false, true, true]);
    expect(ranking[2]?.rd).toBeCloseTo(319, 0);
  });
});
