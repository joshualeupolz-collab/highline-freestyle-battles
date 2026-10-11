/**
 * RuleSets: versioned rating parameters (rating specification §0.4). A rule change is a new
 * version; existing versions are never changed. Battles store the version they use.
 */

import type { RuleSetParams } from '@hfb/rating';
import { createRulesetRequestSchema, ruleSetParamsSchema } from '@hfb/shared';
import { desc, eq, lte, max } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import { replayRequests, rulesets } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';

export const rulesetRoutes = new Hono<AppEnv>();

type RulesetRow = typeof rulesets.$inferSelect;

/** Parses stored parameters; throws if the stored JSON does not match the schema. */
export function parseRulesetParams(row: RulesetRow): RuleSetParams {
  return ruleSetParamsSchema.parse(JSON.parse(row.paramsJson)) as RuleSetParams;
}

function toResponse(row: RulesetRow) {
  return {
    version: row.version,
    validFrom: row.validFrom,
    note: row.note,
    params: parseRulesetParams(row),
  };
}

/** The RuleSet that applies at `at`: the latest one whose `valid_from` has passed. */
export async function currentRuleset(db: Database, at = Date.now()) {
  return db
    .select()
    .from(rulesets)
    .where(lte(rulesets.validFrom, at))
    .orderBy(desc(rulesets.validFrom), desc(rulesets.version))
    .get();
}

rulesetRoutes.get('/', async (c) => {
  const rows = await getDb(c.env.DB).select().from(rulesets).orderBy(rulesets.version);
  return c.json({ rulesets: rows.map(toResponse) });
});

rulesetRoutes.get('/current', async (c) => {
  const row = await currentRuleset(getDb(c.env.DB));
  if (!row) return c.json({ error: 'no_ruleset' }, 404);
  return c.json(toResponse(row));
});

rulesetRoutes.get('/:version{[0-9]+}', async (c) => {
  const row = await getDb(c.env.DB)
    .select()
    .from(rulesets)
    .where(eq(rulesets.version, Number(c.req.param('version'))))
    .get();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(toResponse(row));
});

/** New RuleSet version. It applies to battles created from `validFrom` on. */
rulesetRoutes.post('/', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, createRulesetRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const latest = await db
    .select({ version: max(rulesets.version) })
    .from(rulesets)
    .get();
  const version = (latest?.version ?? 0) + 1;
  await db.batch([
    db.insert(rulesets).values({
      version,
      paramsJson: JSON.stringify(input.params),
      validFrom: input.validFrom ?? now,
      note: input.note,
      createdBy: actor.id,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'ruleset.create',
        targetType: 'ruleset',
        targetId: String(version),
        reason: input.note,
        payload: input.params,
      },
      now,
    ),
  ]);
  const row = await db.select().from(rulesets).where(eq(rulesets.version, version)).get();
  if (!row) apiError(500, 'internal_error');
  return c.json(toResponse(row), 201);
});

/**
 * Request a full rating recalculation (e.g. after a RuleSet change). The daily GitHub Actions job
 * (.github/workflows/replay.yml) does it; it can also be started there by hand.
 */
rulesetRoutes.post('/replay', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const { reason } = await parseJson(c, z.object({ reason: z.string().trim().min(3).max(500) }));
  const db = getDb(c.env.DB);
  const now = Date.now();
  const id = newId(now);
  await db.batch([
    db.insert(replayRequests).values({ id, reason, requestedBy: actor.id, createdAt: now }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'rating.replay_request',
        targetType: 'replay',
        targetId: id,
        reason,
      },
      now,
    ),
  ]);
  return c.json({ id }, 201);
});
