/**
 * Rating events: the raw input of the engine (rating specification sections 2.1, 3 and 5).
 *
 * An event is one decided battle: a single battle, a group battle or the final placement of a
 * competition. The engine does not care which of these it was: every event with n people is
 * split into all pairs, each pair weighted `WEIGHT[level] / (n − 1)`. A single battle is
 * therefore just the case n = 2.
 */
import type { Comparison } from './glicko2';
import { isWeightLevel, type WeightLevel } from './params';
import { scoreFromPlacement, scoreFromPoints } from './score';

/** How the result of an event is given. */
export type EventScoring =
  /** Score s of the first participant (n = 2 only): 1 / 0 / 0.5 or a 5-point scale value. */
  | 'score'
  /** Points per participant, converted with s = a^k / (a^k + b^k). */
  | 'points'
  /** Placement per participant, lower is better, ties allowed. */
  | 'placement';

export interface EventParticipant {
  personId: string;
  /** Score for `scoring: 'score'`. Required for the first participant, optional for the second. */
  score?: number;
  /** Points for `scoring: 'points'`. */
  points?: number;
  /** Placement for `scoring: 'placement'`. */
  placement?: number;
}

export interface RatingEvent {
  id: string;
  /** Format the battle was played in (merged formats are resolved by the engine). */
  formatId: string;
  /** Time the result became final and counts, in milliseconds since the epoch (UTC). */
  timestamp: number;
  level: WeightLevel;
  /** RuleSet version the event is rated with. */
  rulesetVersion: number;
  scoring: EventScoring;
  participants: readonly EventParticipant[];
}

export class RatingInputError extends Error {
  override name = 'RatingInputError';
}

/** A comparison of one person against one opponent, with the opponent's id. */
export interface PairComparison extends Omit<Comparison, 'r' | 'rd'> {
  opponentId: string;
}

/** Tolerance for "the two scores of a single battle add up to 1". */
const SCORE_SUM_TOLERANCE = 1e-9;

/**
 * Validates an event and splits it into pairwise comparisons per person.
 * `levelWeight` is `WEIGHT[event.level]`; `kPoints` is the exponent for points → score.
 */
export function expandEvent(
  event: RatingEvent,
  levelWeight: number,
  kPoints: number,
): Map<string, PairComparison[]> {
  validateEvent(event);
  const people = event.participants;
  const n = people.length;
  const pairWeight = levelWeight / (n - 1);
  const result = new Map<string, PairComparison[]>(people.map((p) => [p.personId, []]));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = people[i] as EventParticipant;
      const b = people[j] as EventParticipant;
      const sA = pairScore(event, a, b, kPoints);
      result.get(a.personId)?.push({ opponentId: b.personId, score: sA, weight: pairWeight });
      result.get(b.personId)?.push({ opponentId: a.personId, score: 1 - sA, weight: pairWeight });
    }
  }
  return result;
}

function pairScore(
  event: RatingEvent,
  a: EventParticipant,
  b: EventParticipant,
  kPoints: number,
): number {
  switch (event.scoring) {
    case 'score':
      return a.score as number;
    case 'points':
      return scoreFromPoints(a.points as number, b.points as number, kPoints);
    case 'placement':
      return scoreFromPlacement(a.placement as number, b.placement as number);
  }
}

function validateEvent(event: RatingEvent): void {
  const fail = (message: string): never => {
    throw new RatingInputError(`Event ${event.id}: ${message}`);
  };
  const people = event.participants;

  if (!Number.isFinite(event.timestamp)) fail('timestamp must be a finite number');
  if (!isWeightLevel(event.level)) fail(`invalid weight level ${String(event.level)}`);
  if (people.length < 2) fail('needs at least 2 participants');
  if (new Set(people.map((p) => p.personId)).size !== people.length) {
    fail('a person appears more than once');
  }

  switch (event.scoring) {
    case 'score': {
      if (people.length !== 2) fail("scoring 'score' needs exactly 2 participants");
      const [a, b] = people as [EventParticipant, EventParticipant];
      if (a.score === undefined || !(a.score >= 0 && a.score <= 1)) {
        fail('score of the first participant must be between 0 and 1');
      }
      if (
        b.score !== undefined &&
        Math.abs((a.score as number) + b.score - 1) > SCORE_SUM_TOLERANCE
      ) {
        fail('scores of both participants must add up to 1');
      }
      break;
    }
    case 'points':
      for (const p of people) {
        if (p.points === undefined || !(p.points >= 0) || !Number.isFinite(p.points)) {
          fail(`points of ${p.personId} must be a non-negative number`);
        }
      }
      break;
    case 'placement':
      for (const p of people) {
        if (p.placement === undefined || !Number.isFinite(p.placement)) {
          fail(`placement of ${p.personId} is missing`);
        }
      }
      break;
    default:
      fail(`unknown scoring ${String(event.scoring)}`);
  }
}

/** Deterministic replay order: by timestamp, ties broken by id (specification section 2.1). */
export function compareEvents(a: RatingEvent, b: RatingEvent): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
