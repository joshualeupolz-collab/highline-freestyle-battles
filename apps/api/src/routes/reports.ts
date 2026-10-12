/**
 * Reports (concept section 11): approved users report a battle, a video or a profile; the
 * federation and admins see the open reports and close them with a note. Nobody handles a
 * report that concerns themselves or a battle they took part in (conflict of interest).
 */
import { closeReportSchema, createReportSchema, type ReportTarget } from '@hfb/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import { battleParticipants, battles, reports, users, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';

/** Open reports one person may have at the same time (against spamming the federation). */
export const MAX_OPEN_REPORTS = 10;

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use(requireUser({ active: true }));

/**
 * What a report is about: the people it concerns (for the conflict-of-interest rule) and the
 * battle to link to. Null when the target does not exist.
 */
async function resolveTarget(db: Database, type: ReportTarget, id: string) {
  if (type === 'user') {
    const user = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, id))
      .get();
    return user && user.status !== 'deleted' ? { involved: [id], battleId: null } : null;
  }
  let battleId = id;
  let owner: string | null = null;
  if (type === 'video') {
    const video = await db
      .select({ ownerId: videos.ownerId, battleId: videos.battleId, status: videos.status })
      .from(videos)
      .where(eq(videos.id, id))
      .get();
    if (!video || video.status === 'deleted') return null;
    owner = video.ownerId;
    if (!video.battleId) return { involved: [owner], battleId: null };
    battleId = video.battleId;
  }
  const battle = await db
    .select({ id: battles.id })
    .from(battles)
    .where(eq(battles.id, battleId))
    .get();
  if (!battle) return null;
  const participants = await db
    .select({ userId: battleParticipants.userId })
    .from(battleParticipants)
    .where(eq(battleParticipants.battleId, battleId));
  const involved = new Set(participants.map((p) => p.userId));
  if (owner) involved.add(owner);
  return { involved: [...involved], battleId };
}

/** Report something. One open report per person and target. */
reportRoutes.post('/', async (c) => {
  const actor = c.get('user');
  if (!actor) apiError(401, 'not_logged_in');
  const input = await parseJson(c, createReportSchema);
  const db = getDb(c.env.DB);
  if (input.targetType === 'user' && input.targetId === actor.id)
    apiError(400, 'cannot_report_yourself');
  if (!(await resolveTarget(db, input.targetType, input.targetId))) apiError(404, 'not_found');

  const mineOpen = await db
    .select({ targetType: reports.targetType, targetId: reports.targetId })
    .from(reports)
    .where(and(eq(reports.reporterId, actor.id), eq(reports.status, 'open')));
  if (mineOpen.some((r) => r.targetType === input.targetType && r.targetId === input.targetId))
    apiError(409, 'already_reported');
  if (mineOpen.length >= MAX_OPEN_REPORTS) apiError(429, 'too_many_open_reports');

  const now = Date.now();
  const id = newId(now);
  await db.insert(reports).values({ id, reporterId: actor.id, ...input, createdAt: now });
  return c.json({ id }, 201);
});

/** My own reports and whether they were handled (without the handler's note). */
reportRoutes.get('/mine', async (c) => {
  const actor = c.get('user');
  if (!actor) apiError(401, 'not_logged_in');
  const rows = await getDb(c.env.DB)
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      category: reports.category,
      text: reports.text,
      status: reports.status,
      createdAt: reports.createdAt,
      closedAt: reports.closedAt,
    })
    .from(reports)
    .where(eq(reports.reporterId, actor.id))
    .orderBy(desc(reports.createdAt))
    .limit(50);
  return c.json({ reports: rows });
});

/**
 * Reports for the federation and admins: open ones first (`?status=closed` for the handled
 * ones). `canHandle` is false for reports that concern the viewer.
 */
reportRoutes.get('/', async (c) => {
  const actor = c.get('user');
  if (!actor || !can.handleReports(actor)) apiError(403, 'forbidden');
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.status, status))
    .orderBy(status === 'open' ? reports.createdAt : desc(reports.closedAt))
    .limit(100);

  const targets = await Promise.all(rows.map((r) => resolveTarget(db, r.targetType, r.targetId)));
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.reporterId);
    if (r.closedBy) ids.add(r.closedBy);
    if (r.targetType === 'user') ids.add(r.targetId);
  }
  for (const t of targets) for (const u of t?.involved ?? []) ids.add(u);
  const people = ids.size
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...ids]))
    : [];
  const person = (id: string | null) => people.find((p) => p.id === id) ?? null;

  return c.json({
    reports: rows.map((r, i) => {
      const target = targets[i];
      return {
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        battleId: target?.battleId ?? null,
        involved: (target?.involved ?? []).map(person).filter((p) => p !== null),
        category: r.category,
        text: r.text,
        status: r.status,
        reporter: person(r.reporterId),
        createdAt: r.createdAt,
        closedBy: person(r.closedBy),
        closedAt: r.closedAt,
        closeNote: r.closeNote,
        canHandle: !(target?.involved ?? []).includes(actor.id),
      };
    }),
  });
});

/** Number of open reports, for the badge on the profile button. */
reportRoutes.get('/open-count', async (c) => {
  const actor = c.get('user');
  if (!actor || !can.handleReports(actor)) return c.json({ count: 0 });
  const rows = await getDb(c.env.DB)
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.status, 'open'))
    .limit(100);
  return c.json({ count: rows.length });
});

/** Close a report with a note on what was done. Audited. */
reportRoutes.post('/:id/close', async (c) => {
  const actor = c.get('user');
  if (!actor || !can.handleReports(actor)) apiError(403, 'forbidden');
  const { note } = await parseJson(c, closeReportSchema);
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const report = await db.select().from(reports).where(eq(reports.id, id)).get();
  if (!report) apiError(404, 'not_found');
  if (report.status !== 'open') apiError(409, 'report_closed');
  const target = await resolveTarget(db, report.targetType, report.targetId);
  if (target?.involved.includes(actor.id)) apiError(403, 'conflict_of_interest');

  const now = Date.now();
  await db.batch([
    db
      .update(reports)
      .set({ status: 'closed', closedBy: actor.id, closedAt: now, closeNote: note })
      .where(and(eq(reports.id, id), eq(reports.status, 'open'))),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'report.close',
        targetType: report.targetType,
        targetId: report.targetId,
        reason: note,
        payload: { reportId: id, category: report.category },
      },
      now,
    ),
  ]);
  return c.json({ ok: true });
});
