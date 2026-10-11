import { desc, eq, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import { rulesets } from '../db/schema';
import type { AppEnv } from '../env';

export const rulesetRoutes = new Hono<AppEnv>();

function toResponse(row: typeof rulesets.$inferSelect) {
  return {
    version: row.version,
    validFrom: row.validFrom,
    note: row.note,
    params: JSON.parse(row.paramsJson) as unknown,
  };
}

/** The RuleSet that applies now: the latest one whose `valid_from` has passed. */
rulesetRoutes.get('/current', async (c) => {
  const row = await getDb(c.env.DB)
    .select()
    .from(rulesets)
    .where(lte(rulesets.validFrom, Date.now()))
    .orderBy(desc(rulesets.validFrom), desc(rulesets.version))
    .get();
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
