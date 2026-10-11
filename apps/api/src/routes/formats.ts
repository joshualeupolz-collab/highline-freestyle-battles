/**
 * Formats (concept section 4). Reading is public; changes need `can.manageRules` and are
 * audited. The parts of a format are versioned: a change creates a new version, battles keep
 * the version they were played with.
 */
import {
  createFormatRequestSchema,
  newFormatVersionRequestSchema,
  updateFormatRequestSchema,
} from '@hfb/shared';
import { desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import { formats, formatVersions, replayRequests } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';

export const formatRoutes = new Hono<AppEnv>();

type FormatRow = typeof formats.$inferSelect;
type VersionRow = typeof formatVersions.$inferSelect;

function toResponse(f: FormatRow, version: VersionRow | undefined) {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    description: f.description,
    status: f.status,
    kPoints: f.kPoints,
    mergedInto: f.mergedInto,
    archivedAt: f.archivedAt,
    version: version?.version ?? null,
    parts: version ? (JSON.parse(version.partsJson) as unknown) : [],
  };
}

export async function latestFormatVersion(db: Database, formatId: string) {
  return db
    .select()
    .from(formatVersions)
    .where(eq(formatVersions.formatId, formatId))
    .orderBy(desc(formatVersions.version))
    .get();
}

async function loadFormat(db: Database, id: string) {
  const format = await db.select().from(formats).where(eq(formats.id, id)).get();
  if (!format) apiError(404, 'not_found');
  return format;
}

/** All formats that are not archived, each with the parts of its latest version. */
formatRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const [rows, versions] = await Promise.all([
    db.select().from(formats).where(isNull(formats.archivedAt)).orderBy(formats.name),
    db.select().from(formatVersions),
  ]);
  const latest = new Map<string, VersionRow>();
  for (const v of versions) {
    const current = latest.get(v.formatId);
    if (!current || v.version > current.version) latest.set(v.formatId, v);
  }
  return c.json({ formats: rows.map((f) => toResponse(f, latest.get(f.id))) });
});

/** One format with all its versions (also archived formats). */
formatRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const format = await loadFormat(db, c.req.param('id'));
  const versions = await db
    .select()
    .from(formatVersions)
    .where(eq(formatVersions.formatId, format.id))
    .orderBy(formatVersions.version);
  return c.json({
    format: toResponse(format, versions.at(-1)),
    versions: versions.map((v) => ({
      version: v.version,
      parts: JSON.parse(v.partsJson) as unknown,
      createdAt: v.createdAt,
    })),
  });
});

formatRoutes.post('/', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, createFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const taken = await db
    .select({ id: formats.id })
    .from(formats)
    .where(eq(formats.slug, input.slug))
    .get();
  if (taken) apiError(409, 'slug_taken');

  const id = newId(now);
  await db.batch([
    db.insert(formats).values({
      id,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      kPoints: input.kPoints ?? null,
      createdBy: actor.id,
      createdAt: now,
    }),
    db.insert(formatVersions).values({
      formatId: id,
      version: 1,
      partsJson: JSON.stringify(input.parts),
      createdBy: actor.id,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'format.create',
        targetType: 'format',
        targetId: id,
        payload: input,
      },
      now,
    ),
  ]);
  const format = await loadFormat(db, id);
  return c.json({ format: toResponse(format, await latestFormatVersion(db, id)) }, 201);
});

/** Change name, description, status or kPoints. A new kPoints value needs a rating replay. */
formatRoutes.patch('/:id', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const { reason, ...changes } = await parseJson(c, updateFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const format = await loadFormat(db, c.req.param('id'));

  const kPointsChanged = changes.kPoints !== undefined && changes.kPoints !== format.kPoints;
  await db.batch([
    db.update(formats).set(changes).where(eq(formats.id, format.id)),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'format.update',
        targetType: 'format',
        targetId: format.id,
        reason,
        payload: { before: format, changes },
      },
      now,
    ),
    ...(kPointsChanged
      ? [
          db.insert(replayRequests).values({
            id: newId(now),
            formatId: format.id,
            reason: 'format k_points changed',
            requestedBy: actor.id,
            createdAt: now,
          }),
        ]
      : []),
  ]);
  const updated = await loadFormat(db, format.id);
  return c.json({ format: toResponse(updated, await latestFormatVersion(db, format.id)) });
});

/** New parts definition. Running battles keep their version. */
formatRoutes.post('/:id/versions', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, newFormatVersionRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const format = await loadFormat(db, c.req.param('id'));
  const version = ((await latestFormatVersion(db, format.id))?.version ?? 0) + 1;

  await db.batch([
    db.insert(formatVersions).values({
      formatId: format.id,
      version,
      partsJson: JSON.stringify(input.parts),
      createdBy: actor.id,
      createdAt: now,
    }),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'format.new_version',
        targetType: 'format',
        targetId: format.id,
        reason: input.reason,
        payload: { version, parts: input.parts },
      },
      now,
    ),
  ]);
  return c.json({ version, parts: input.parts }, 201);
});

/** Archived formats can no longer be chosen for new battles; old battles stay valid. */
formatRoutes.post('/:id/archive', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const db = getDb(c.env.DB);
  const now = Date.now();
  const format = await loadFormat(db, c.req.param('id'));
  if (format.archivedAt !== null) apiError(409, 'already_archived');
  await db.batch([
    db.update(formats).set({ archivedAt: now }).where(eq(formats.id, format.id)),
    auditInsert(
      db,
      { actorId: actor.id, action: 'format.archive', targetType: 'format', targetId: format.id },
      now,
    ),
  ]);
  return c.json({ ok: true });
});
