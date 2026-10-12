/**
 * The audit log (concept section 2): every action using special permissions, newest first.
 * Visible to the federation and admins.
 */
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { getDb } from '../db/client';
import { auditLog, users } from '../db/schema';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';

const PAGE = 50;

export const auditRoutes = new Hono<AppEnv>();
auditRoutes.use(requireUser({ active: true }));

/**
 * One page of entries. `?before=<id>` continues after the last entry of the previous page
 * (ids are UUIDv7 and sort by time); `?targetType=&targetId=` shows the history of one thing (e.g. one battle).
 */
auditRoutes.get('/', async (c) => {
  if (!can.viewAuditLog(c.get('user'))) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const before = c.req.query('before');
  const targetType = c.req.query('targetType');
  const targetId = c.req.query('targetId');

  const filters: SQL[] = [];
  if (before) filters.push(lt(auditLog.id, before));
  if (targetType) filters.push(eq(auditLog.targetType, targetType));
  if (targetId) filters.push(eq(auditLog.targetId, targetId));
  const rows = await db
    .select()
    .from(auditLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(PAGE);

  // Names of the people involved (actors, approvers and target users), in one query.
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.actorId) ids.add(r.actorId);
    if (r.federationApprovalBy) ids.add(r.federationApprovalBy);
    if (r.targetType === 'user' && r.targetId) ids.add(r.targetId);
  }
  const people = ids.size
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...ids]))
    : [];
  const person = (id: string | null) => (id ? (people.find((p) => p.id === id) ?? null) : null);

  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: person(r.actorId),
      targetType: r.targetType,
      targetId: r.targetId,
      targetUser: r.targetType === 'user' ? person(r.targetId) : null,
      reason: r.reason,
      payload: r.payloadJson ? (JSON.parse(r.payloadJson) as unknown) : null,
      federationApprovalBy: person(r.federationApprovalBy),
      createdAt: r.createdAt,
    })),
    // Pass as ?before= for the next page; null when this was the last one.
    next: rows.length === PAGE ? (rows.at(-1)?.id ?? null) : null,
  });
});
