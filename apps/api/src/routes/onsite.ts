/**
 * On-site battles (concept section 8, architecture step 11): only the result is entered. It is a
 * `result` proposal by the person entering it; the battle counts once the other side accepts it.
 *
 * Status: negotiating (waiting for confirmation) → decided, or cancelled (withdrawn, or not
 * confirmed within ONSITE_CONFIRM_DAYS – the hourly job lets it expire like an open request).
 * Rejecting a result does not end the battle: either side can enter a different one.
 */
import {
  createOnsiteBattleSchema,
  MAX_FREE_LEVEL,
  ONSITE_CONFIRM_DAYS,
  ONSITE_MAX_AGE_DAYS,
} from '@hfb/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { getDb, runBatch } from '../db/client';
import { battleParticipants, battleProposals, battles, formats, users } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { cancelStatements } from '../services/battles';
import { battleResponse, loadBattle, requireParticipant } from './battles';
import { latestFormatVersion } from './formats';
import { currentRuleset } from './rulesets';

const DAY = 86_400_000;

export const onsiteRoutes = new Hono<AppEnv>();
onsiteRoutes.use(requireUser({ active: true }));

/** Enter the result of a battle that took place on site; the opponent has to confirm it. */
onsiteRoutes.post('/onsite', async (c) => {
  const user = c.get('user');
  if (!user || !can.battle(user)) apiError(403, 'forbidden');
  const input = await parseJson(c, createOnsiteBattleSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  if (input.level > MAX_FREE_LEVEL) apiError(400, 'level_requires_approval');
  if (input.playedAt > now + 5 * 60_000) apiError(400, 'played_in_future');
  if (input.playedAt < now - ONSITE_MAX_AGE_DAYS * DAY) apiError(400, 'played_too_long_ago');
  if (input.opponentId === user.id) apiError(400, 'cannot_challenge_yourself');

  const format = await db.select().from(formats).where(eq(formats.id, input.formatId)).get();
  if (!format || format.archivedAt !== null || format.approvedAt === null)
    apiError(400, 'unknown_format');
  const opponent = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, input.opponentId))
    .get();
  if (opponent?.status !== 'active') apiError(400, 'unknown_opponent');
  const version = await latestFormatVersion(db, format.id);
  const ruleset = await currentRuleset(db, now);
  if (!version || !ruleset) apiError(500, 'internal_error');

  const id = newId(now);
  await db.batch([
    db.insert(battles).values({
      id,
      formatId: format.id,
      formatVersion: version.version,
      rulesetVersion: ruleset.version,
      kind: 'single',
      mode: 'onsite',
      status: 'negotiating',
      level: input.level,
      scoring: input.scoring,
      reviewMode: 'quick',
      attemptsPerVideo: null,
      // Not confirmed by then: the hourly job lets it expire.
      deadlineAt: now + ONSITE_CONFIRM_DAYS * DAY,
      invitedUserId: input.opponentId,
      createdBy: user.id,
      createdAt: now,
      acceptedAt: now,
      playedAt: input.playedAt,
    }),
    db.insert(battleParticipants).values([
      { battleId: id, userId: user.id, seat: 0, joinedAt: now },
      { battleId: id, userId: input.opponentId, seat: 1, joinedAt: now },
    ]),
    db.insert(battleProposals).values({
      id: newId(now),
      battleId: id,
      kind: 'result',
      payloadJson: JSON.stringify({ value: input.value }),
      proposedBy: user.id,
      createdAt: now,
    }),
  ]);
  return c.json(await battleResponse(db, id, user.id, now), 201);
});

/** "This battle did not take place (like this)": either side ends it without rating. */
onsiteRoutes.post('/:id/withdraw-onsite', async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const { battle, participants } = await loadBattle(db, c.req.param('id'));
  requireParticipant(participants, user.id);
  if (battle.mode !== 'onsite' || battle.status !== 'negotiating') apiError(409, 'not_pending');
  await runBatch(db, cancelStatements(db, battle.id, 'onsite_withdrawn'));
  return c.json(await battleResponse(db, battle.id, user.id));
});
