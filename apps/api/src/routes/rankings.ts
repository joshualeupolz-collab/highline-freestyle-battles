/**
 * Combined rankings (rating specification section 8.2): several formats normalized to z-values,
 * the X worst dropped, the rest averaged.
 *
 * - Official (no query): all *relevant* formats (or the RuleSet's `officialCombo.formatIds`),
 *   the `officialCombo.dropWorst` worst dropped – 1 by default (owner, 2026-10-12).
 * - Free: `?formats=a,b,c&drop=1`, any formats, any number dropped.
 */
import { combinedRanking, type RankingEntry } from '@hfb/rating';
import { officialCombo } from '@hfb/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { getDb } from '../db/client';
import { formats, ratingStates, users } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { displayParams, ratingView } from '../services/ratingView';

const MAX_FORMATS = 20;

export const rankingRoutes = new Hono<AppEnv>();
rankingRoutes.use(requireUser({ active: true }));

rankingRoutes.get('/combined', async (c) => {
  const db = getDb(c.env.DB);
  const params = await displayParams(db);
  const usable = await db
    .select({ id: formats.id, name: formats.name, status: formats.status })
    .from(formats)
    .where(
      and(isNull(formats.archivedAt), isNotNull(formats.approvedAt), isNull(formats.mergedInto)),
    );

  const requested = c.req.query('formats');
  const official = requested === undefined;
  const config = officialCombo(params);
  let formatIds: string[];
  let dropWorst: number;
  if (official) {
    formatIds = config.formatIds ?? usable.filter((f) => f.status === 'relevant').map((f) => f.id);
    dropWorst = config.dropWorst;
  } else {
    formatIds = [...new Set(requested.split(',').filter(Boolean))];
    dropWorst = Number(c.req.query('drop') ?? 0);
    if (!Number.isInteger(dropWorst) || dropWorst < 0 || dropWorst > MAX_FORMATS)
      apiError(400, 'validation_failed');
  }
  if (formatIds.length === 0 || formatIds.length > MAX_FORMATS) apiError(400, 'validation_failed');
  const chosen = formatIds.map((id) => usable.find((f) => f.id === id));
  if (chosen.some((f) => !f)) apiError(400, 'unknown_format');

  const rows = await db
    .select({ state: ratingStates, username: users.username, displayName: users.displayName })
    .from(ratingStates)
    .innerJoin(users, eq(users.id, ratingStates.userId))
    .where(and(inArray(ratingStates.formatId, formatIds), eq(users.status, 'active')));
  const now = Date.now();
  const rankings = new Map<string, RankingEntry[]>();
  for (const { state } of rows) {
    const view = ratingView(state, params, now);
    const list = rankings.get(state.formatId) ?? [];
    list.push({
      personId: state.userId,
      r: view.r,
      rd: view.rd,
      rankingValue: view.rankingValue,
      nBattles: view.nBattles,
      provisional: view.provisional,
    });
    rankings.set(state.formatId, list);
  }
  const people = new Map(rows.map((r) => [r.state.userId, r]));
  const combined = combinedRanking(formatIds, rankings, dropWorst, params);

  return c.json({
    official,
    dropWorst,
    formats: chosen.map((f) => ({ id: f?.id, name: f?.name })),
    ranking: combined.map((e, i) => ({
      rank: i + 1,
      userId: e.personId,
      username: people.get(e.personId)?.username ?? '',
      displayName: people.get(e.personId)?.displayName ?? '',
      value: Math.round(e.value * 100) / 100,
      z: e.z.map((z) => (z === null ? null : Math.round(z * 100) / 100)),
      formatsPlayed: e.formatsPlayed,
    })),
  });
});
