/**
 * Official competitions (concept section 8, rating specification section 5.2).
 *
 * - An organizer (or the federation) creates a competition with a weight 1–5 (owner,
 *   2026-10-12: levels 1 and 2 too; 4–5 only exist here) and enters its results: single battles,
 *   or the final placement per format.
 * - Results are battles with `competition_id`, stored with their score/placement but kept
 *   `negotiating` – they do not count yet.
 * - A judge or the federation, who neither organized it nor took part, confirms the competition.
 *   Then every result is decided and rated at the confirmation time (spec §4: levels 4–5 count
 *   from their approval). In a format with single battles, its final placement is ignored
 *   (spec §5.2), so nothing counts twice.
 */
import {
  competitionBattleSchema,
  competitionPlacementSchema,
  createCompetitionSchema,
} from '@hfb/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { voteScore } from '../battles/review';
import { type Database, getDb, runBatch } from '../db/client';
import { battleParticipants, battles, competitions, formats, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { cancelStatements, decideStatements } from '../services/battles';
import { latestFormatVersion } from './formats';
import { currentRuleset } from './rulesets';

export const competitionRoutes = new Hono<AppEnv>();
competitionRoutes.use(requireUser({ active: true }));

type CompetitionRow = typeof competitions.$inferSelect;

async function loadCompetition(db: Database, id: string) {
  const competition = await db.select().from(competitions).where(eq(competitions.id, id)).get();
  if (!competition) apiError(404, 'not_found');
  return competition;
}

/** The results that are still open (entered, not confirmed or removed). */
async function openResults(db: Database, competitionId: string) {
  return db
    .select()
    .from(battles)
    .where(and(eq(battles.competitionId, competitionId), eq(battles.status, 'negotiating')))
    .orderBy(battles.createdAt);
}

function requireEditable(competition: CompetitionRow, userId: string) {
  if (competition.organizerId !== userId) apiError(403, 'not_the_organizer');
  if (competition.status === 'confirmed' || competition.status === 'cancelled')
    apiError(409, 'competition_closed');
}

async function checkFormat(db: Database, formatId: string) {
  const format = await db.select().from(formats).where(eq(formats.id, formatId)).get();
  if (!format || format.archivedAt !== null || format.approvedAt === null)
    apiError(400, 'unknown_format');
  return format;
}

async function checkPeople(db: Database, ids: string[]) {
  const people = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(inArray(users.id, ids));
  if (people.length !== ids.length || people.some((p) => p.status !== 'active'))
    apiError(400, 'unknown_opponent');
}

/** A result battle, stored with its result but not counting yet. */
async function resultStatements(
  db: Database,
  competition: CompetitionRow,
  input: {
    formatId: string;
    kind: 'single' | 'placement';
    scoring: 'scale' | 'win_loss' | 'placement';
    people: { userId: string; score?: number; placement?: number }[];
  },
  userId: string,
  now: number,
) {
  const format = await checkFormat(db, input.formatId);
  const version = await latestFormatVersion(db, format.id);
  const ruleset = await currentRuleset(db, now);
  if (!version || !ruleset) apiError(500, 'internal_error');
  const id = newId(now);
  return {
    id,
    statements: [
      db.insert(battles).values({
        id,
        formatId: format.id,
        formatVersion: version.version,
        rulesetVersion: ruleset.version,
        kind: input.kind,
        mode: 'onsite',
        status: 'negotiating',
        level: competition.level,
        scoring: input.scoring,
        reviewMode: 'quick',
        attemptsPerVideo: null,
        deadlineAt: null,
        competitionId: competition.id,
        createdBy: userId,
        createdAt: now,
        acceptedAt: now,
        playedAt: competition.startsAt ?? now,
      }),
      db.insert(battleParticipants).values(
        input.people.map((p, seat) => ({
          battleId: id,
          userId: p.userId,
          seat,
          joinedAt: now,
          score: p.score ?? null,
          placement: p.placement ?? null,
        })),
      ),
    ],
  };
}

/** Competitions, newest first. */
competitionRoutes.get('/', async (c) => {
  const rows = await getDb(c.env.DB)
    .select({
      id: competitions.id,
      name: competitions.name,
      location: competitions.location,
      startsAt: competitions.startsAt,
      level: competitions.level,
      status: competitions.status,
      organizer: { id: users.id, username: users.username, displayName: users.displayName },
    })
    .from(competitions)
    .innerJoin(users, eq(users.id, competitions.organizerId))
    .orderBy(desc(competitions.startsAt))
    .limit(100);
  return c.json({ competitions: rows });
});

/** Create a competition (organizers and the federation). */
competitionRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user || !can.organizeCompetitions(user)) apiError(403, 'forbidden');
  const input = await parseJson(c, createCompetitionSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const id = newId(now);
  await db.batch([
    db.insert(competitions).values({
      id,
      name: input.name,
      location: input.location ?? null,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      level: input.level,
      organizerId: user.id,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId: user.id,
        action: 'competition.create',
        targetType: 'competition',
        targetId: id,
        payload: { name: input.name, level: input.level },
      },
      now,
    ),
  ]);
  return c.json({ id }, 201);
});

/** A competition with its results and what the viewer may do. */
competitionRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  const results = await db
    .select()
    .from(battles)
    .where(eq(battles.competitionId, competition.id))
    .orderBy(battles.createdAt);
  const kept = results.filter((b) => b.cancelReason !== 'removed');
  const people = kept.length
    ? await db
        .select({
          battleId: battleParticipants.battleId,
          userId: users.id,
          displayName: users.displayName,
          seat: battleParticipants.seat,
          score: battleParticipants.score,
          placement: battleParticipants.placement,
        })
        .from(battleParticipants)
        .innerJoin(users, eq(users.id, battleParticipants.userId))
        .where(
          inArray(
            battleParticipants.battleId,
            kept.map((b) => b.id),
          ),
        )
    : [];
  const [organizer, confirmer] = await Promise.all(
    [competition.organizerId, competition.confirmedBy].map((id) =>
      id
        ? db
            .select({ id: users.id, username: users.username, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, id))
            .get()
        : Promise.resolve(undefined),
    ),
  );
  const takesPart = people.some((p) => p.userId === user.id);
  const open = competition.status !== 'confirmed' && competition.status !== 'cancelled';
  return c.json({
    competition: {
      ...competition,
      organizer: organizer ?? null,
      confirmedBy: confirmer ?? null,
    },
    results: kept.map((b) => ({
      battleId: b.id,
      formatId: b.formatId,
      kind: b.kind,
      scoring: b.scoring,
      status: b.status,
      cancelReason: b.cancelReason,
      participants: people
        .filter((p) => p.battleId === b.id)
        .sort((x, y) => x.seat - y.seat)
        .map(({ battleId: _, ...p }) => p),
    })),
    canEdit: open && competition.organizerId === user.id,
    canConfirm:
      competition.status === 'finished' &&
      can.confirmCompetitions(user) &&
      competition.organizerId !== user.id &&
      !takesPart,
  });
});

/** Add a single battle (A against B). */
competitionRoutes.post('/:id/battles', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, competitionBattleSchema);
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  if (input.aId === input.bId) apiError(400, 'cannot_challenge_yourself');
  await checkPeople(db, [input.aId, input.bId]);
  const scoreA = voteScore(input.value, input.scoring);
  const now = Date.now();
  const { id, statements } = await resultStatements(
    db,
    competition,
    {
      formatId: input.formatId,
      kind: 'single',
      scoring: input.scoring,
      people: [
        { userId: input.aId, score: scoreA },
        { userId: input.bId, score: 1 - scoreA },
      ],
    },
    user.id,
    now,
  );
  await runBatch(db, statements);
  return c.json({ battleId: id }, 201);
});

/** Set the final placement in one format (replaces an earlier one of that format). */
competitionRoutes.post('/:id/placements', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, competitionPlacementSchema);
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  await checkPeople(
    db,
    input.placements.map((p) => p.userId),
  );
  const now = Date.now();
  const earlier = (await openResults(db, competition.id)).filter(
    (b) => b.kind === 'placement' && b.formatId === input.formatId,
  );
  const { id, statements } = await resultStatements(
    db,
    competition,
    {
      formatId: input.formatId,
      kind: 'placement',
      scoring: 'placement',
      people: [...input.placements].sort((a, b) => a.placement - b.placement),
    },
    user.id,
    now,
  );
  await runBatch(db, [
    ...earlier.flatMap((b) => cancelStatements(db, b.id, 'removed', now)),
    ...statements,
  ]);
  return c.json({ battleId: id }, 201);
});

/** Remove a result before the competition is confirmed. */
competitionRoutes.post('/:id/results/:battleId/remove', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  const result = (await openResults(db, competition.id)).find(
    (b) => b.id === c.req.param('battleId'),
  );
  if (!result) apiError(404, 'not_found');
  await runBatch(db, cancelStatements(db, result.id, 'removed'));
  return c.json({ ok: true });
});

/** The organizer is done entering results: ask a judge or the federation to confirm. */
competitionRoutes.post('/:id/submit', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  if ((await openResults(db, competition.id)).length === 0) apiError(409, 'no_results');
  await db
    .update(competitions)
    .set({ status: 'finished' })
    .where(eq(competitions.id, competition.id));
  return c.json({ ok: true });
});

/** Back to editing (before the confirmation). */
competitionRoutes.post('/:id/reopen', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  await db
    .update(competitions)
    .set({ status: 'planned' })
    .where(eq(competitions.id, competition.id));
  return c.json({ ok: true });
});

/** The organizer calls the competition off; its results never count. */
competitionRoutes.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  requireEditable(competition, user.id);
  const now = Date.now();
  const results = await openResults(db, competition.id);
  await runBatch(db, [
    db.update(competitions).set({ status: 'cancelled' }).where(eq(competitions.id, competition.id)),
    ...results.flatMap((b) => cancelStatements(db, b.id, 'competition_cancelled', now)),
    auditInsert(
      db,
      {
        actorId: user.id,
        action: 'competition.cancel',
        targetType: 'competition',
        targetId: competition.id,
      },
      now,
    ),
  ]);
  return c.json({ ok: true });
});

/**
 * A judge or the federation confirms: every result is decided and rated now. Formats with single
 * battles ignore their final placement. Audited.
 */
competitionRoutes.post('/:id/confirm', async (c) => {
  const user = c.get('user');
  if (!user || !can.confirmCompetitions(user)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const competition = await loadCompetition(db, c.req.param('id'));
  if (competition.status !== 'finished') apiError(409, 'competition_not_finished');
  if (competition.organizerId === user.id) apiError(403, 'conflict_of_interest');
  const results = await openResults(db, competition.id);
  const people = results.length
    ? await db
        .select()
        .from(battleParticipants)
        .where(
          inArray(
            battleParticipants.battleId,
            results.map((b) => b.id),
          ),
        )
    : [];
  if (people.some((p) => p.userId === user.id)) apiError(403, 'conflict_of_interest');

  const now = Date.now();
  // Claim it first, so a second confirmation at the same moment does nothing.
  const claimed = await db
    .update(competitions)
    .set({ status: 'confirmed', confirmedBy: user.id, confirmedAt: now })
    .where(and(eq(competitions.id, competition.id), eq(competitions.status, 'finished')))
    .returning({ id: competitions.id });
  if (claimed.length === 0) apiError(409, 'competition_not_finished');

  const withSingles = new Set(results.filter((b) => b.kind === 'single').map((b) => b.formatId));
  let tick = 0;
  for (const battle of results) {
    if (battle.kind === 'placement' && withSingles.has(battle.formatId)) {
      await runBatch(db, cancelStatements(db, battle.id, 'superseded_by_battles', now));
      continue;
    }
    const seats = people.filter((p) => p.battleId === battle.id).sort((a, b) => a.seat - b.seat);
    const resultsOf =
      battle.kind === 'single'
        ? seats.map((p) => ({ userId: p.userId, score: p.score ?? 0 }))
        : seats.map((p) => ({ userId: p.userId, placement: p.placement ?? seats.length }));
    // One millisecond apart, so the events of one competition keep their order.
    const at = now + tick++;
    await runBatch(db, [
      db
        .update(battles)
        .set({ levelApprovedBy: user.id, levelApprovedAt: at })
        .where(eq(battles.id, battle.id)),
      ...(await decideStatements(db, battle, resultsOf, 'competition', at)),
    ]);
  }
  await auditInsert(
    db,
    {
      actorId: user.id,
      action: 'competition.confirm',
      targetType: 'competition',
      targetId: competition.id,
      payload: { results: results.length, level: competition.level },
    },
    now,
  );
  return c.json({ ok: true });
});
