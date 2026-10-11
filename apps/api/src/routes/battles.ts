/**
 * Battle flow (concept section 5): request, acceptance, settings, change proposals,
 * goodwill, cancellation and missed deadlines. Recording, upload and review follow later.
 *
 * Status:  open → (negotiating →) active → reviewing → decided
 *          any of the first three can end as cancelled.
 */
import {
  type BattleSettings,
  checkDeadline,
  createBattleRequestSchema,
  deadlineDecisionSchema,
  defaultBattleSettings,
  MAX_FREE_LEVEL,
  proposalRequestSchema,
  proposalResponseSchema,
  reviewVoteSchema,
  sendMessageRequestSchema,
} from '@hfb/shared';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { voteScore } from '../battles/review';
import {
  deliveryStatus,
  effectiveDeadline,
  isDeadlinePassed,
  settingsOf,
  winnerScores,
} from '../battles/rules';
import { type Database, getDb, runBatch } from '../db/client';
import {
  battleMessages,
  battleParticipants,
  battleProposals,
  battles,
  formats,
  proposalResponses,
  ratingHistory,
  ratingStates,
  reviewVotes,
  submissions,
  users,
  videos,
} from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import {
  cancelPendingProposalsStatement,
  cancelStatements,
  decideStatements,
  requiredSubmissionsPerPerson,
} from '../services/battles';
import { displayParams, ratingView } from '../services/ratingView';
import { reviewView, settleReview } from '../services/review';
import { battleVideosView } from '../services/videos';
import { latestFormatVersion } from './formats';
import { currentRuleset, parseRulesetParams } from './rulesets';

export const battleRoutes = new Hono<AppEnv>();
battleRoutes.use(requireUser({ active: true }));

// ---------------------------------------------------------------------------------------------
// Loading and response shape
// ---------------------------------------------------------------------------------------------

export async function loadBattle(db: Database, id: string) {
  const battle = await db.select().from(battles).where(eq(battles.id, id)).get();
  if (!battle) apiError(404, 'not_found');
  const participants = await db
    .select({
      userId: battleParticipants.userId,
      seat: battleParticipants.seat,
      extraAttempts: battleParticipants.extraAttempts,
      score: battleParticipants.score,
      username: users.username,
      displayName: users.displayName,
    })
    .from(battleParticipants)
    .innerJoin(users, eq(users.id, battleParticipants.userId))
    .where(eq(battleParticipants.battleId, id))
    .orderBy(battleParticipants.seat);
  return { battle, participants };
}

type Participants = Awaited<ReturnType<typeof loadBattle>>['participants'];

async function pendingProposals(db: Database, battleId: string) {
  const rows = await db
    .select()
    .from(battleProposals)
    .where(and(eq(battleProposals.battleId, battleId), eq(battleProposals.status, 'pending')))
    .orderBy(battleProposals.createdAt);
  const responses = rows.length
    ? await db
        .select()
        .from(proposalResponses)
        .where(
          inArray(
            proposalResponses.proposalId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    payload: JSON.parse(p.payloadJson) as unknown,
    proposedBy: p.proposedBy,
    createdAt: p.createdAt,
    acceptedBy: responses
      .filter((r) => r.proposalId === p.id && r.decision === 'accept')
      .map((r) => r.userId),
  }));
}

export async function battleResponse(
  db: Database,
  battleId: string,
  viewerId: string | null,
  now = Date.now(),
) {
  const { battle, participants } = await loadBattle(db, battleId);
  const [states, params] = await Promise.all([
    db
      .select()
      .from(ratingStates)
      .where(
        and(
          eq(ratingStates.formatId, battle.formatId),
          inArray(
            ratingStates.userId,
            participants.map((p) => p.userId),
          ),
        ),
      ),
    displayParams(db),
  ]);
  const withRatings = participants.map((p) => {
    const state = states.find((s) => s.userId === p.userId);
    return { ...p, rating: state ? ratingView(state, params, now) : null };
  });
  return {
    battle: {
      id: battle.id,
      formatId: battle.formatId,
      formatVersion: battle.formatVersion,
      rulesetVersion: battle.rulesetVersion,
      kind: battle.kind,
      mode: battle.mode,
      status: battle.status,
      settings: settingsOf(battle),
      settingsFlexible: battle.settingsFlexible,
      invitedUserId: battle.invitedUserId,
      createdBy: battle.createdBy,
      createdAt: battle.createdAt,
      acceptedAt: battle.acceptedAt,
      playedAt: battle.playedAt,
      deadlineAt: battle.deadlineAt,
      deadlinePassed: battle.status === 'active' && isDeadlinePassed(battle, now),
      decidedAt: battle.decidedAt,
      decisionReason: battle.decisionReason,
      cancelReason: battle.cancelReason,
      participants: withRatings,
      proposals: await pendingProposals(db, battle.id),
      videos: await battleVideosView(
        db,
        battle,
        participants.map((p) => p.userId),
        viewerId,
      ),
      review: await reviewView(
        db,
        battle,
        participants.map((p) => p.userId),
        viewerId,
      ),
      ratingChanges:
        battle.status === 'decided'
          ? await db
              .select({
                userId: ratingHistory.userId,
                before: ratingHistory.rBefore,
                after: ratingHistory.rAfter,
              })
              .from(ratingHistory)
              .where(eq(ratingHistory.battleId, battle.id))
          : [],
    },
  };
}

export function requireParticipant(participants: Participants, userId: string) {
  if (!participants.some((p) => p.userId === userId)) apiError(403, 'not_a_participant');
}

// ---------------------------------------------------------------------------------------------
// Requests and acceptance
// ---------------------------------------------------------------------------------------------

/** Post an open request (or challenge one person directly). */
battleRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user || !can.battle(user)) apiError(403, 'forbidden');
  const input = await parseJson(c, createBattleRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const settings: BattleSettings = { ...defaultBattleSettings(now), ...input.settings };
  if (settings.level > MAX_FREE_LEVEL) apiError(400, 'level_requires_approval');
  const deadlineProblem = checkDeadline(settings.deadlineAt, now);
  if (deadlineProblem) apiError(400, deadlineProblem);

  const format = await db.select().from(formats).where(eq(formats.id, input.formatId)).get();
  if (!format || format.archivedAt !== null || format.approvedAt === null) {
    apiError(400, 'unknown_format');
  }
  const version = await latestFormatVersion(db, format.id);
  const ruleset = await currentRuleset(db, now);
  if (!version || !ruleset) apiError(500, 'internal_error');

  if (input.invitedUserId !== undefined) {
    if (input.invitedUserId === user.id) apiError(400, 'cannot_challenge_yourself');
    const invited = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, input.invitedUserId))
      .get();
    if (invited?.status !== 'active') apiError(400, 'unknown_opponent');
  }

  const id = newId(now);
  await db.batch([
    db.insert(battles).values({
      id,
      formatId: format.id,
      formatVersion: version.version,
      rulesetVersion: ruleset.version,
      kind: 'single',
      mode: 'online',
      status: 'open',
      level: settings.level,
      scoring: settings.scoring,
      reviewMode: settings.reviewMode,
      attemptsPerVideo: settings.attemptsPerVideo,
      deadlineAt: settings.deadlineAt,
      settingsFlexible: input.settingsFlexible,
      invitedUserId: input.invitedUserId ?? null,
      createdBy: user.id,
      createdAt: now,
    }),
    db.insert(battleParticipants).values({ battleId: id, userId: user.id, seat: 0, joinedAt: now }),
  ]);
  return c.json(await battleResponse(db, id, user?.id ?? null, now), 201);
});

/**
 * Open requests I can accept, closest in rating first (concept section 5.1).
 * Optional `?formatId=`.
 */
battleRoutes.get('/open', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const formatId = c.req.query('formatId');

  const rows = await db
    .select({
      battle: battles,
      username: users.username,
      displayName: users.displayName,
      r: ratingStates.r,
      rd: ratingStates.rd,
      nBattles: ratingStates.nBattles,
    })
    .from(battles)
    .innerJoin(users, eq(users.id, battles.createdBy))
    .leftJoin(
      ratingStates,
      and(eq(ratingStates.formatId, battles.formatId), eq(ratingStates.userId, battles.createdBy)),
    )
    .where(
      and(
        eq(battles.status, 'open'),
        // Requests whose deadline has passed can no longer be accepted.
        or(isNull(battles.deadlineAt), gt(battles.deadlineAt, Date.now())),
        ne(battles.createdBy, user.id),
        or(isNull(battles.invitedUserId), eq(battles.invitedUserId, user.id)),
        formatId ? eq(battles.formatId, formatId) : undefined,
      ),
    )
    .orderBy(desc(battles.createdAt))
    .limit(100);

  const mine = await db.select().from(ratingStates).where(eq(ratingStates.userId, user.id));
  const ruleset = await currentRuleset(db);
  const rDefault = ruleset ? parseRulesetParams(ruleset).rDefault : 1500;
  const myRating = (f: string) => mine.find((s) => s.formatId === f)?.r ?? rDefault;

  const requests = rows
    .map((row) => ({
      id: row.battle.id,
      formatId: row.battle.formatId,
      settings: settingsOf(row.battle),
      settingsFlexible: row.battle.settingsFlexible,
      direct: row.battle.invitedUserId !== null,
      createdAt: row.battle.createdAt,
      challenger: {
        userId: row.battle.createdBy,
        username: row.username,
        displayName: row.displayName,
        rating: row.r === null ? null : { r: row.r, rd: row.rd, nBattles: row.nBattles },
      },
      ratingDistance: Math.abs((row.r ?? rDefault) - myRating(row.battle.formatId)),
    }))
    .sort((a, b) => Number(b.direct) - Number(a.direct) || a.ratingDistance - b.ratingDistance);
  return c.json({ requests });
});

/** My battles (as participant or challenged), newest first. */
battleRoutes.get('/mine', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const mineIds = db
    .select({ id: battleParticipants.battleId })
    .from(battleParticipants)
    .where(eq(battleParticipants.userId, user.id));
  const rows = await db
    .select()
    .from(battles)
    .where(or(inArray(battles.id, mineIds), eq(battles.invitedUserId, user.id)))
    .orderBy(desc(battles.createdAt))
    .limit(100);
  const people = rows.length
    ? await db
        .select({
          battleId: battleParticipants.battleId,
          userId: battleParticipants.userId,
          seat: battleParticipants.seat,
          score: battleParticipants.score,
          username: users.username,
          displayName: users.displayName,
        })
        .from(battleParticipants)
        .innerJoin(users, eq(users.id, battleParticipants.userId))
        .where(
          inArray(
            battleParticipants.battleId,
            rows.map((b) => b.id),
          ),
        )
        .orderBy(battleParticipants.seat)
    : [];
  // New chat messages from others since I last opened each battle.
  const unread = rows.length
    ? await db
        .select({ battleId: battleMessages.battleId, n: sql<number>`count(*)` })
        .from(battleMessages)
        .innerJoin(
          battleParticipants,
          and(
            eq(battleParticipants.battleId, battleMessages.battleId),
            eq(battleParticipants.userId, user.id),
          ),
        )
        .where(
          and(
            inArray(
              battleMessages.battleId,
              rows.map((b) => b.id),
            ),
            ne(battleMessages.senderId, user.id),
            sql`${battleMessages.createdAt} > coalesce(${battleParticipants.lastReadMessageAt}, 0)`,
          ),
        )
        .groupBy(battleMessages.battleId)
    : [];
  const now = Date.now();
  return c.json({
    battles: rows.map((b) => ({
      unreadMessages: unread.find((u) => u.battleId === b.id)?.n ?? 0,
      id: b.id,
      formatId: b.formatId,
      mode: b.mode,
      status: b.status,
      settings: settingsOf(b),
      createdBy: b.createdBy,
      invitedUserId: b.invitedUserId,
      createdAt: b.createdAt,
      deadlineAt: b.deadlineAt,
      deadlinePassed: b.status === 'active' && isDeadlinePassed(b, now),
      decisionReason: b.decisionReason,
      participants: people.filter((p) => p.battleId === b.id).map(({ battleId: _, ...p }) => p),
    })),
  });
});

battleRoutes.get('/:id', async (c) =>
  c.json(await battleResponse(getDb(c.env.DB), c.req.param('id'), c.get('user')?.id ?? null)),
);

/** Accept a request. Fixed settings start the battle; flexible ones lead to negotiation. */
battleRoutes.post('/:id/accept', async (c) => {
  const user = c.get('user');
  if (!user || !can.battle(user)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle } = await loadBattle(db, c.req.param('id'));
  if (battle.status !== 'open') apiError(409, 'not_open');
  if (battle.createdBy === user.id) apiError(400, 'cannot_accept_own_request');
  if (battle.invitedUserId !== null && battle.invitedUserId !== user.id)
    apiError(403, 'not_invited');

  if (battle.deadlineAt !== null && battle.deadlineAt <= now) apiError(409, 'deadline_passed');

  const start = battle.settingsFlexible
    ? { status: 'negotiating' as const }
    : { status: 'active' as const, deadlineAt: effectiveDeadline(battle, now) };
  try {
    await db.batch([
      db
        .update(battles)
        .set({ ...start, acceptedAt: now })
        .where(and(eq(battles.id, battle.id), eq(battles.status, 'open'))),
      // The unique (battle, seat) index makes a second, simultaneous acceptance fail.
      db
        .insert(battleParticipants)
        .values({ battleId: battle.id, userId: user.id, seat: 1, joinedAt: now }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) apiError(409, 'not_open');
    throw err;
  }
  return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
});

/** The challenger takes back a request nobody has accepted yet. */
battleRoutes.post('/:id/retract', async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const { battle } = await loadBattle(db, c.req.param('id'));
  if (battle.createdBy !== user?.id) apiError(403, 'forbidden');
  if (battle.status !== 'open') apiError(409, 'not_open');
  await runBatch(db, cancelStatements(db, battle.id, 'retracted'));
  return c.json(await battleResponse(db, battle.id, user?.id ?? null));
});

/** During negotiation: the accepting side agrees to the settings as they are. */
battleRoutes.post('/:id/start', async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  if (battle.status !== 'negotiating' || battle.mode !== 'online') apiError(409, 'not_negotiating');
  // The challenger proposed these settings, so the other side's consent completes the agreement.
  const acceptor = participants.find((p) => p.seat === 1);
  if (acceptor?.userId !== user?.id) apiError(403, 'only_the_accepting_side_can_start');
  if (battle.deadlineAt !== null && battle.deadlineAt <= now) apiError(409, 'deadline_passed');
  await db.batch([
    db
      .update(battles)
      .set({ status: 'active', deadlineAt: effectiveDeadline(battle, now) })
      .where(eq(battles.id, battle.id)),
    db
      .update(battleProposals)
      .set({ status: 'withdrawn', resolvedAt: now })
      .where(
        and(
          eq(battleProposals.battleId, battle.id),
          eq(battleProposals.status, 'pending'),
          eq(battleProposals.kind, 'settings'),
        ),
      ),
  ]);
  return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
});

// ---------------------------------------------------------------------------------------------
// Proposals: "everything can be changed if both sides agree"
// ---------------------------------------------------------------------------------------------

battleRoutes.post('/:id/proposals', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const input = await parseJson(c, proposalRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.status !== 'negotiating' && battle.status !== 'active')
    apiError(409, 'battle_not_running');
  // On-site battles only have a result to agree on; online battles get theirs from the review.
  if ((battle.mode === 'onsite') !== (input.kind === 'result'))
    apiError(400, 'unsupported_proposal');

  if (input.kind === 'settings') {
    if ((input.changes.level ?? 0) > MAX_FREE_LEVEL) apiError(400, 'level_requires_approval');
    if (input.changes.deadlineAt !== undefined) {
      const problem = checkDeadline(input.changes.deadlineAt, now);
      if (problem) apiError(400, problem);
    }
  }
  if (input.kind === 'extension') {
    if (battle.status !== 'active') apiError(409, 'battle_not_running');
    if (
      input.deadlineAt <= now ||
      (battle.deadlineAt !== null && input.deadlineAt <= battle.deadlineAt)
    ) {
      apiError(400, 'deadline_must_be_later');
    }
  }

  let payload: Record<string, unknown>;
  if (input.kind === 'extra_attempt') {
    if (battle.status !== 'active') apiError(409, 'battle_not_running');
    const others = participants.filter((p) => p.userId !== user.id);
    const target = others.length === 1 ? others[0] : undefined;
    if (!target) apiError(400, 'unsupported_for_group_battles');
    if (input.change === -1) {
      if (target.extraAttempts < 1) apiError(409, 'no_extra_attempt_to_take_back');
      payload = { change: -1, userId: target.userId };
    } else {
      // A request for myself, optionally with the cut-off video for the opponent to watch.
      if (input.videoId) {
        const video = await db.select().from(videos).where(eq(videos.id, input.videoId)).get();
        if (!video || video.ownerId !== user.id || video.battleId !== battle.id)
          apiError(404, 'video_not_found');
      }
      payload = { change: 1, userId: user.id, videoId: input.videoId };
    }
  } else {
    const { kind: _, ...rest } = input;
    payload = rest;
  }

  const id = newId(now);
  const kind = input.kind;
  await db.batch([
    // A new proposal replaces my own earlier pending one of the same kind.
    db
      .update(battleProposals)
      .set({ status: 'withdrawn', resolvedAt: now })
      .where(
        and(
          eq(battleProposals.battleId, battle.id),
          eq(battleProposals.proposedBy, user.id),
          eq(battleProposals.kind, kind),
          eq(battleProposals.status, 'pending'),
        ),
      ),
    db.insert(battleProposals).values({
      id,
      battleId: battle.id,
      kind,
      payloadJson: JSON.stringify(payload),
      proposedBy: user.id,
      createdAt: now,
    }),
  ]);
  return c.json(await battleResponse(db, battle.id, user?.id ?? null, now), 201);
});

battleRoutes.post('/:id/proposals/:proposalId/withdraw', async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const proposal = await db
    .select()
    .from(battleProposals)
    .where(eq(battleProposals.id, c.req.param('proposalId')))
    .get();
  if (!proposal || proposal.battleId !== c.req.param('id')) apiError(404, 'not_found');
  if (proposal.proposedBy !== user?.id) apiError(403, 'forbidden');
  if (proposal.status !== 'pending') apiError(409, 'not_pending');
  await db
    .update(battleProposals)
    .set({ status: 'withdrawn', resolvedAt: Date.now() })
    .where(eq(battleProposals.id, proposal.id));
  return c.json(await battleResponse(db, proposal.battleId, user?.id ?? null));
});

/**
 * Accept or reject a proposal. It takes effect once every other participant has accepted.
 * Rejecting a "cancel" proposal means: the battle counts as a win for the rejecting side.
 */
battleRoutes.post('/:id/proposals/:proposalId/respond', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { decision } = await parseJson(c, proposalResponseSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  const proposal = await db
    .select()
    .from(battleProposals)
    .where(eq(battleProposals.id, c.req.param('proposalId')))
    .get();
  if (!proposal || proposal.battleId !== battle.id) apiError(404, 'not_found');
  if (proposal.status !== 'pending') apiError(409, 'not_pending');
  if (proposal.proposedBy === user.id) apiError(400, 'cannot_respond_to_own_proposal');
  if (battle.status !== 'negotiating' && battle.status !== 'active')
    apiError(409, 'battle_not_running');

  const response = db
    .insert(proposalResponses)
    .values({ proposalId: proposal.id, userId: user.id, decision, createdAt: now });
  const resolve = (status: 'accepted' | 'rejected') =>
    db
      .update(battleProposals)
      .set({ status, resolvedAt: now })
      .where(eq(battleProposals.id, proposal.id));
  const payload = JSON.parse(proposal.payloadJson) as Record<string, unknown>;

  if (decision === 'reject') {
    const statements: BatchItem<'sqlite'>[] = [response, resolve('rejected')];
    if (proposal.kind === 'cancel') {
      const seatOrder = participants.map((p) => p.userId);
      statements.push(
        ...(await decideStatements(db, battle, winnerScores(seatOrder, user.id), 'forfeit', now)),
      );
    }
    await runBatch(db, statements);
    return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
  }

  const earlier = await db
    .select({ userId: proposalResponses.userId })
    .from(proposalResponses)
    .where(
      and(eq(proposalResponses.proposalId, proposal.id), eq(proposalResponses.decision, 'accept')),
    );
  const accepted = new Set([...earlier.map((r) => r.userId), user.id]);
  const others = participants.filter((p) => p.userId !== proposal.proposedBy);
  if (!others.every((p) => accepted.has(p.userId))) {
    await response;
    return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
  }

  const statements: BatchItem<'sqlite'>[] = [response, resolve('accepted')];
  switch (proposal.kind) {
    case 'settings': {
      const changes = payload.changes as Partial<BattleSettings>;
      const starts = battle.status === 'negotiating';
      statements.push(
        db
          .update(battles)
          .set({
            ...changes,
            ...(starts && changes.deadlineAt === undefined
              ? { status: 'active' as const, deadlineAt: effectiveDeadline(battle, now) }
              : starts
                ? { status: 'active' as const }
                : {}),
          })
          .where(eq(battles.id, battle.id)),
      );
      break;
    }
    case 'result': {
      // On-site result confirmed by the other side (value seen from the proposer's view).
      const seat0 = participants.find((p) => p.seat === 0)?.userId;
      const fromSeat0 =
        proposal.proposedBy === seat0 ? (payload.value as number) : -(payload.value as number);
      const s0 = voteScore(fromSeat0, battle.scoring);
      const results = participants.map((p) => ({
        userId: p.userId,
        score: p.seat === 0 ? s0 : 1 - s0,
      }));
      statements.push(
        ...(await decideStatements(db, battle, results, 'onsite', now)),
        cancelPendingProposalsStatement(db, battle.id, now),
      );
      break;
    }
    case 'extension':
      statements.push(
        db
          .update(battles)
          .set({ deadlineAt: payload.deadlineAt as number })
          .where(eq(battles.id, battle.id)),
      );
      break;
    case 'cancel':
      statements.push(...cancelStatements(db, battle.id, 'agreed'));
      break;
    case 'extra_attempt': {
      // -1: take back an extra attempt given by mistake; +1: grant a requested one.
      const change = payload.change === 1 ? 1 : -1;
      statements.push(
        db
          .update(battleParticipants)
          .set({
            extraAttempts: sql`max(${battleParticipants.extraAttempts} + ${change}, 0)`,
          })
          .where(
            and(
              eq(battleParticipants.battleId, battle.id),
              eq(battleParticipants.userId, payload.userId as string),
            ),
          ),
      );
      break;
    }
    default:
      apiError(400, 'unsupported_proposal');
  }
  await runBatch(db, statements);
  return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
});

// ---------------------------------------------------------------------------------------------
// Goodwill and missed deadlines
// ---------------------------------------------------------------------------------------------

/** Goodwill: give the opponent one more attempt (e.g. after a mis-tap shown on video). */
battleRoutes.post('/:id/grant-attempt', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  const others = participants.filter((p) => p.userId !== user.id);
  const target = others.length === 1 ? others[0] : undefined;
  if (!target) apiError(400, 'unsupported_for_group_battles');
  await db
    .update(battleParticipants)
    .set({ extraAttempts: sql`${battleParticipants.extraAttempts} + 1` })
    .where(
      and(eq(battleParticipants.battleId, battle.id), eq(battleParticipants.userId, target.userId)),
    );
  return c.json(await battleResponse(db, battle.id, user?.id ?? null));
});

/**
 * After the deadline: whoever delivered decides whether the battle counts as their win or is
 * cancelled unrated. If nobody delivered, it can only be cancelled.
 */
battleRoutes.post('/:id/deadline-decision', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { choice } = await parseJson(c, deadlineDecisionSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.status !== 'active') apiError(409, 'battle_not_running');
  if (!isDeadlinePassed(battle, now)) apiError(409, 'deadline_not_passed');

  const required = await requiredSubmissionsPerPerson(db, battle);
  const subs = await db
    .select({ userId: submissions.userId })
    .from(submissions)
    .where(eq(submissions.battleId, battle.id));
  const seatOrder = participants.map((p) => p.userId);
  const { delivered, missing } = deliveryStatus(seatOrder, subs, required);

  if (missing.length === 0) apiError(409, 'everyone_delivered');
  if (delivered.length > 0 && !delivered.includes(user.id))
    apiError(403, 'only_the_delivering_side_decides');
  if (choice === 'claim_win' && delivered.length === 0) apiError(409, 'nobody_delivered');

  const statements =
    choice === 'cancel'
      ? cancelStatements(db, battle.id, 'deadline_missed')
      : await decideStatements(db, battle, winnerScores(seatOrder, user.id), 'deadline', now);
  await runBatch(db, statements);
  return c.json(await battleResponse(db, battle.id, user?.id ?? null, now));
});

// ---------------------------------------------------------------------------------------------
// Review level 1: both athletes vote (concept section 7.1)
// ---------------------------------------------------------------------------------------------

/**
 * Vote on the 5-point scale, seen from seat 0. The vote can be changed while the review runs:
 * if both agree on a side, the battle is decided and the ratings are updated at once.
 */
battleRoutes.post('/:id/vote', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { value } = await parseJson(c, reviewVoteSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.status !== 'reviewing' || battle.reviewLevel !== 1) apiError(409, 'not_in_review');
  if (participants.length !== 2) apiError(400, 'unsupported_for_group_battles');
  await db
    .insert(reviewVotes)
    .values({ battleId: battle.id, voterId: user.id, reviewLevel: 1, value, createdAt: now })
    .onConflictDoUpdate({
      target: [reviewVotes.battleId, reviewVotes.voterId, reviewVotes.reviewLevel],
      set: { value, createdAt: now },
    });
  await settleReview(db, battle, now, false);
  return c.json(await battleResponse(db, battle.id, user.id, now));
});

// ---------------------------------------------------------------------------------------------
// Chat between the participants
// ---------------------------------------------------------------------------------------------

const MESSAGES_PER_PAGE = 200;

/** Messages of a battle, oldest first (`?after=` for only newer ones). Marks them as read. */
battleRoutes.get('/:id/messages', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const { participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  const battleId = c.req.param('id');
  const after = Number(c.req.query('after') ?? 0) || 0;

  const rows = await db
    .select({
      id: battleMessages.id,
      senderId: battleMessages.senderId,
      body: battleMessages.body,
      createdAt: battleMessages.createdAt,
    })
    .from(battleMessages)
    .where(and(eq(battleMessages.battleId, battleId), sql`${battleMessages.createdAt} > ${after}`))
    .orderBy(desc(battleMessages.createdAt))
    .limit(MESSAGES_PER_PAGE);
  const messages = rows.reverse();

  // Only write when there is something new, so polling does not cost a write each time.
  const newest = messages.at(-1)?.createdAt;
  const me = await db
    .select({ lastRead: battleParticipants.lastReadMessageAt })
    .from(battleParticipants)
    .where(and(eq(battleParticipants.battleId, battleId), eq(battleParticipants.userId, user.id)))
    .get();
  if (newest !== undefined && newest > (me?.lastRead ?? 0)) {
    await db
      .update(battleParticipants)
      .set({ lastReadMessageAt: newest })
      .where(
        and(eq(battleParticipants.battleId, battleId), eq(battleParticipants.userId, user.id)),
      );
  }
  return c.json({ messages });
});

battleRoutes.post('/:id/messages', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const { body } = await parseJson(c, sendMessageRequestSchema);
  const db = getDb(c.env.DB);
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  const now = Date.now();
  const message = { id: newId(now), battleId: battle.id, senderId: user.id, body, createdAt: now };
  await db.batch([
    db.insert(battleMessages).values(message),
    // My own message counts as read for me.
    db
      .update(battleParticipants)
      .set({ lastReadMessageAt: now })
      .where(
        and(eq(battleParticipants.battleId, battle.id), eq(battleParticipants.userId, user.id)),
      ),
  ]);
  return c.json({ message: { id: message.id, senderId: user.id, body, createdAt: now } }, 201);
});
