/**
 * Rating update when a battle is decided (docs/architecture.md section 3).
 *
 * Loads the participants' current states, applies the single event with the pure engine and
 * returns the write statements, so the caller can put them into the same `db.batch` as the
 * battle's own update (all or nothing). If the event would be out of order, a replay request is
 * written instead and the background job recalculates everything.
 */
import {
  type Estimate,
  OutOfOrderEventError,
  RatingEngine,
  type RatingEvent,
  type WeightLevel,
} from '@hfb/rating';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../db/client';
import {
  formats,
  ratingEstimates,
  ratingHistory,
  ratingStates,
  replayRequests,
  rulesets,
} from '../db/schema';
import { newId } from '../lib/ids';
import { parseRulesetParams } from '../routes/rulesets';

export interface DecidedBattle {
  id: string;
  formatId: string;
  level: number;
  rulesetVersion: number;
  /** Participants in seat order with their score s ∈ [0, 1] (two people, scores add up to 1). */
  results: { userId: string; score: number }[];
}

export async function ratingStatements(
  db: Database,
  battle: DecidedBattle,
  eventAt: number,
): Promise<BatchItem<'sqlite'>[]> {
  const rulesetRow = await db
    .select()
    .from(rulesets)
    .where(eq(rulesets.version, battle.rulesetVersion))
    .get();
  if (!rulesetRow) throw new Error(`RuleSet ${battle.rulesetVersion} missing`);
  const params = parseRulesetParams(rulesetRow);
  const formatRows = await db
    .select({ id: formats.id, kPoints: formats.kPoints, mergedInto: formats.mergedInto })
    .from(formats);

  const userIds = battle.results.map((r) => r.userId);
  const probe = new RatingEngine({
    rulesets: { [battle.rulesetVersion]: params },
    formats: formatRows,
  });
  const ratingFormatId = probe.ratingFormatOf(battle.formatId);

  const stateRows = await db
    .select()
    .from(ratingStates)
    .where(and(eq(ratingStates.formatId, ratingFormatId), inArray(ratingStates.userId, userIds)));
  const withoutState = userIds.filter((id) => !stateRows.some((s) => s.userId === id));
  const estimateRows = withoutState.length
    ? await db
        .select()
        .from(ratingEstimates)
        .where(
          and(
            inArray(ratingEstimates.subjectId, withoutState),
            isNull(ratingEstimates.withdrawnAt),
          ),
        )
    : [];

  const engine = new RatingEngine({
    rulesets: { [battle.rulesetVersion]: params },
    formats: formatRows,
    initialStates: stateRows.map((s) => ({
      personId: s.userId,
      formatId: s.formatId,
      r: s.r,
      rd: s.rd,
      sigma: s.sigma,
      lastEventAt: s.lastEventAt,
      nBattles: s.nBattles,
    })),
    estimates: estimateRows.map(
      (e): Estimate => ({
        subjectId: e.subjectId,
        estimatorId: e.estimatorId,
        formatId: e.formatId,
        kind: e.kind,
        value: e.value,
        timestamp: e.createdAt,
      }),
    ),
  });

  const [first, second] = battle.results;
  if (!first || !second || battle.results.length !== 2)
    throw new Error('Only single battles are rated so far');
  const event: RatingEvent = {
    id: battle.id,
    formatId: battle.formatId,
    timestamp: eventAt,
    level: battle.level as WeightLevel,
    rulesetVersion: battle.rulesetVersion,
    scoring: 'score',
    participants: [
      { personId: first.userId, score: first.score },
      { personId: second.userId, score: second.score },
    ],
  };

  let history: ReturnType<RatingEngine['apply']>;
  try {
    history = engine.apply(event);
  } catch (err) {
    if (!(err instanceof OutOfOrderEventError)) throw err;
    return [
      db.insert(replayRequests).values({
        id: newId(eventAt),
        formatId: ratingFormatId,
        fromEventAt: eventAt,
        reason: `out-of-order battle ${battle.id}`,
        createdAt: eventAt,
      }),
    ];
  }

  const statements: BatchItem<'sqlite'>[] = [];
  for (const h of history) {
    const state = engine.getState(h.personId, ratingFormatId);
    if (!state) continue;
    const values = {
      formatId: ratingFormatId,
      userId: h.personId,
      r: state.r,
      rd: state.rd,
      sigma: state.sigma,
      lastEventAt: state.lastEventAt,
      nBattles: state.nBattles,
      rulesetVersion: battle.rulesetVersion,
      computedAt: eventAt,
    };
    statements.push(
      db
        .insert(ratingStates)
        .values(values)
        .onConflictDoUpdate({
          target: [ratingStates.formatId, ratingStates.userId],
          set: {
            r: sql`excluded.r`,
            rd: sql`excluded.rd`,
            sigma: sql`excluded.sigma`,
            lastEventAt: sql`excluded.last_event_at`,
            nBattles: sql`excluded.n_battles`,
            rulesetVersion: sql`excluded.ruleset_version`,
            computedAt: sql`excluded.computed_at`,
          },
        }),
      db.insert(ratingHistory).values({
        battleId: battle.id,
        userId: h.personId,
        formatId: ratingFormatId,
        eventAt,
        rBefore: h.rBefore,
        rdBefore: h.rdBefore,
        rAfter: h.rAfter,
        rdAfter: h.rdAfter,
        sigmaAfter: h.sigmaAfter,
      }),
    );
  }
  return statements;
}
