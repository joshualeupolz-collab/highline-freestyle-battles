/**
 * On-site group battles (concept section 8, decided by the owner 2026-10-12): one participant
 * enters the placements of everyone (3–20 people, ties allowed). The result counts when all
 * participants confirm it, or when one official person – judge, organizer or federation, not
 * taking part – confirms it for everyone. Rated as one event, each pair weighted 1/(n−1)
 * (rating specification section 5.1).
 *
 * The result is a `result` proposal with `{ placements }`; confirmations are
 * `proposal_responses`. Rejecting keeps the battle open for a corrected result; withdrawing and
 * expiry work as for on-site single battles (routes/onsite.ts).
 */
import {
  createGroupBattleSchema,
  MAX_FREE_LEVEL,
  ONSITE_CONFIRM_DAYS,
  ONSITE_MAX_AGE_DAYS,
  placementsSchema,
} from '@hfb/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { can, hasRole } from '../auth/permissions';
import { type Database, getDb, runBatch } from '../db/client';
import {
  battleParticipants,
  battleProposals,
  battles,
  formats,
  proposalResponses,
  users,
} from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { eventStatement } from '../services/battleEvents';
import { cancelPendingProposalsStatement, decideStatements } from '../services/battles';
import { battleResponse, loadBattle, requireParticipant } from './battles';
import { latestFormatVersion } from './formats';
import { currentRuleset } from './rulesets';

const DAY = 86_400_000;

export const groupRoutes = new Hono<AppEnv>();
groupRoutes.use(requireUser({ active: true }));

type Placements = z.infer<typeof placementsSchema>;

function resultStatements(
  db: Database,
  battleId: string,
  userId: string,
  placements: Placements,
  now: number,
) {
  const proposalId = newId(now);
  return [
    db.insert(battleProposals).values({
      id: proposalId,
      battleId,
      kind: 'result',
      payloadJson: JSON.stringify({ placements }),
      proposedBy: userId,
      createdAt: now,
    }),
    // Entering a result means agreeing to it.
    db.insert(proposalResponses).values({ proposalId, userId, decision: 'accept', createdAt: now }),
    eventStatement(db, battleId, userId, { type: 'group_result' }, now),
  ];
}

async function loadGroup(db: Database, id: string) {
  const loaded = await loadBattle(db, id);
  if (loaded.battle.kind !== 'group') apiError(400, 'not_a_group_battle');
  if (loaded.battle.status !== 'negotiating') apiError(409, 'not_pending');
  const proposal = await db
    .select()
    .from(battleProposals)
    .where(and(eq(battleProposals.battleId, id), eq(battleProposals.status, 'pending')))
    .get();
  return { ...loaded, proposal: proposal ?? null };
}

/** Decide with the placements of the pending result. */
async function decideGroup(
  db: Database,
  battle: typeof battles.$inferSelect,
  participants: { userId: string; seat: number }[],
  proposal: typeof battleProposals.$inferSelect,
  now: number,
  extra: Parameters<typeof runBatch>[1] = [],
) {
  const { placements } = JSON.parse(proposal.payloadJson) as { placements: Placements };
  const results = [...participants]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const placement = placements.find((x) => x.userId === p.userId)?.placement;
      if (placement === undefined) throw new Error('Placement missing');
      return { userId: p.userId, placement };
    });
  try {
    await runBatch(db, [
      db
        .update(battleProposals)
        .set({ status: 'accepted', resolvedAt: now })
        .where(eq(battleProposals.id, proposal.id)),
      ...(await decideStatements(db, battle, results, 'onsite', now)),
      cancelPendingProposalsStatement(db, battle.id, now),
      ...extra,
    ]);
  } catch (error) {
    // The caller claimed the battle; give it back so it can be confirmed again.
    await db.update(battles).set({ status: 'negotiating' }).where(eq(battles.id, battle.id));
    throw error;
  }
}

/** Enter an on-site group battle with everyone's placement. */
groupRoutes.post('/onsite-group', async (c) => {
  const user = c.get('user');
  if (!user || !can.battle(user)) apiError(403, 'forbidden');
  const input = await parseJson(c, createGroupBattleSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  if (input.level > MAX_FREE_LEVEL) apiError(400, 'level_requires_approval');
  if (input.playedAt > now + 5 * 60_000) apiError(400, 'played_in_future');
  if (input.playedAt < now - ONSITE_MAX_AGE_DAYS * DAY) apiError(400, 'played_too_long_ago');
  if (!input.placements.some((p) => p.userId === user.id)) apiError(400, 'must_take_part');

  const format = await db.select().from(formats).where(eq(formats.id, input.formatId)).get();
  if (!format || format.archivedAt !== null || format.approvedAt === null)
    apiError(400, 'unknown_format');
  const ids = input.placements.map((p) => p.userId);
  const people = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(inArray(users.id, ids));
  if (people.length !== ids.length || people.some((p) => p.status !== 'active'))
    apiError(400, 'unknown_opponent');
  const version = await latestFormatVersion(db, format.id);
  const ruleset = await currentRuleset(db, now);
  if (!version || !ruleset) apiError(500, 'internal_error');

  // Seat 0 = the person entering it, then the others in the order given.
  const order = [user.id, ...ids.filter((id) => id !== user.id)];
  const id = newId(now);
  await runBatch(db, [
    db.insert(battles).values({
      id,
      formatId: format.id,
      formatVersion: version.version,
      rulesetVersion: ruleset.version,
      kind: 'group',
      mode: 'onsite',
      status: 'negotiating',
      level: input.level,
      scoring: 'placement',
      reviewMode: 'quick',
      attemptsPerVideo: null,
      deadlineAt: now + ONSITE_CONFIRM_DAYS * DAY,
      createdBy: user.id,
      createdAt: now,
      acceptedAt: now,
      playedAt: input.playedAt,
    }),
    db
      .insert(battleParticipants)
      .values(order.map((userId, seat) => ({ battleId: id, userId, seat, joinedAt: now }))),
    ...resultStatements(db, id, user.id, input.placements, now),
  ]);
  return c.json(await battleResponse(db, id, user.id, now), 201);
});

/** A participant enters different placements (replaces the pending result). */
groupRoutes.post('/:id/group-result', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { placements } = await parseJson(c, z.object({ placements: placementsSchema }));
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants, proposal } = await loadGroup(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  const ids = new Set(participants.map((p) => p.userId));
  if (placements.length !== ids.size || placements.some((p) => !ids.has(p.userId)))
    apiError(400, 'placements_must_match_participants');
  await runBatch(db, [
    ...(proposal
      ? [
          db
            .update(battleProposals)
            .set({ status: 'withdrawn', resolvedAt: now })
            .where(eq(battleProposals.id, proposal.id)),
        ]
      : []),
    ...resultStatements(db, battle.id, user.id, placements, now),
  ]);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/** A participant confirms the pending result; once everyone has, it counts. */
groupRoutes.post('/:id/group-confirm', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants, proposal } = await loadGroup(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (!proposal) apiError(409, 'no_result');
  await db
    .insert(proposalResponses)
    .values({ proposalId: proposal.id, userId: user.id, decision: 'accept', createdAt: now })
    .onConflictDoUpdate({
      target: [proposalResponses.proposalId, proposalResponses.userId],
      set: { decision: 'accept', createdAt: now },
    });
  await eventStatement(db, battle.id, user.id, { type: 'group_confirmed' }, now);
  const accepted = await db
    .select({ userId: proposalResponses.userId })
    .from(proposalResponses)
    .where(
      and(eq(proposalResponses.proposalId, proposal.id), eq(proposalResponses.decision, 'accept')),
    );
  if (participants.every((p) => accepted.some((a) => a.userId === p.userId))) {
    // Only the request that moves the battle out of `negotiating` decides it.
    const claimed = await db
      .update(battles)
      .set({ status: 'decided' })
      .where(and(eq(battles.id, battle.id), eq(battles.status, 'negotiating')))
      .returning({ id: battles.id });
    if (claimed.length > 0) await decideGroup(db, battle, participants, proposal, now);
  }
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/** A participant rejects the pending result; someone has to enter a corrected one. */
groupRoutes.post('/:id/group-reject', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants, proposal } = await loadGroup(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (!proposal) apiError(409, 'no_result');
  await runBatch(db, [
    db
      .update(battleProposals)
      .set({ status: 'rejected', resolvedAt: now })
      .where(eq(battleProposals.id, proposal.id)),
    db
      .insert(proposalResponses)
      .values({ proposalId: proposal.id, userId: user.id, decision: 'reject', createdAt: now })
      .onConflictDoUpdate({
        target: [proposalResponses.proposalId, proposalResponses.userId],
        set: { decision: 'reject', createdAt: now },
      }),
    eventStatement(db, battle.id, user.id, { type: 'group_rejected' }, now),
  ]);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

/**
 * An official (judge, organizer or federation) who does not take part confirms the result for
 * everyone. Audited.
 */
groupRoutes.post('/:id/official-confirm', async (c) => {
  const user = c.get('user');
  if (!user || !hasRole(user, 'judge', 'organizer', 'federation')) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants, proposal } = await loadGroup(db, c.req.param('id'));
  if (participants.some((p) => p.userId === user.id)) apiError(403, 'conflict_of_interest');
  if (!proposal) apiError(409, 'no_result');
  const claimed = await db
    .update(battles)
    .set({ status: 'decided' })
    .where(and(eq(battles.id, battle.id), eq(battles.status, 'negotiating')))
    .returning({ id: battles.id });
  if (claimed.length === 0) apiError(409, 'not_pending');
  await decideGroup(db, battle, participants, proposal, now, [
    eventStatement(
      db,
      battle.id,
      user.id,
      { type: 'official_confirmed', name: user.displayName },
      now,
    ),
    auditInsert(
      db,
      {
        actorId: user.id,
        action: 'battle.official_confirm',
        targetType: 'battle',
        targetId: battle.id,
        payload: { proposalId: proposal.id },
      },
      now,
    ),
  ]);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});
