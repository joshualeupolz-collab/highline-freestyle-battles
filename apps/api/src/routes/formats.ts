/**
 * Formats (concept section 4). Reading is public; changes need `can.manageRules` and are
 * audited. The parts of a format are versioned: a change creates a new version, battles keep
 * the version they were played with.
 *
 * Any athlete can propose a format. A proposal (approved_at = NULL) cannot be used for
 * battles until the federation/admin approves it as official (`relevant`) or other (`fun`).
 */
import {
  approveFormatRequestSchema,
  createFormatRequestSchema,
  type FormatPart,
  MAX_OPEN_PROPOSALS,
  newFormatVersionRequestSchema,
  proposeFormatRequestSchema,
  rejectFormatRequestSchema,
  updateFormatRequestSchema,
} from '@hfb/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { can } from '../auth/permissions';
import { type Database, getDb } from '../db/client';
import { formats, formatVersions, ratingStates, replayRequests, users } from '../db/schema';
import type { AppEnv } from '../env';
import { auditInsert } from '../lib/audit';
import { apiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/validate';
import { displayParams, ratingView } from '../services/ratingView';

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
    approvedAt: f.approvedAt,
    reviewNote: f.reviewNote,
    createdBy: f.createdBy,
    createdAt: f.createdAt,
    version: version?.version ?? null,
    parts: version ? (JSON.parse(version.partsJson) as unknown) : [],
  };
}

/** "pending" | "approved" | "rejected" (rejected proposals are archived without approval). */
function proposalState(f: FormatRow) {
  if (f.approvedAt !== null) return 'approved';
  return f.archivedAt === null ? 'pending' : 'rejected';
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

/** Latest version of each of the given formats. */
async function latestVersions(db: Database, formatIds: string[]) {
  const latest = new Map<string, VersionRow>();
  if (formatIds.length === 0) return latest;
  const versions = await db
    .select()
    .from(formatVersions)
    .where(inArray(formatVersions.formatId, formatIds));
  for (const v of versions) {
    const current = latest.get(v.formatId);
    if (!current || v.version > current.version) latest.set(v.formatId, v);
  }
  return latest;
}

/** A free slug derived from the name, e.g. "5-Trick Combo" → "5-trick-combo" (or "-2", …). */
async function uniqueSlug(db: Database, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || 'format';
  const rows = await db
    .select({ slug: formats.slug })
    .from(formats)
    .where(like(formats.slug, `${base}%`));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function insertFormat(
  db: Database,
  id: string,
  values: {
    slug: string;
    name: string;
    description?: string;
    status: 'relevant' | 'fun';
    kPoints?: number | null;
    parts: FormatPart[];
    createdBy: string;
    approved: boolean;
  },
  extra: Parameters<Database['batch']>[0][number][],
  now: number,
): Promise<void> {
  await db.batch([
    db.insert(formats).values({
      id,
      slug: values.slug,
      name: values.name,
      description: values.description ?? null,
      status: values.status,
      kPoints: values.kPoints ?? null,
      createdBy: values.createdBy,
      createdAt: now,
      approvedAt: values.approved ? now : null,
      approvedBy: values.approved ? values.createdBy : null,
    }),
    db.insert(formatVersions).values({
      formatId: id,
      version: 1,
      partsJson: JSON.stringify(values.parts),
      createdBy: values.createdBy,
      createdAt: now,
    }),
    ...extra,
  ]);
}

/** Approved formats that are not archived, each with the parts of its latest version. */
formatRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(formats)
    .where(and(isNull(formats.archivedAt), isNotNull(formats.approvedAt)))
    .orderBy(formats.name);
  const latest = await latestVersions(
    db,
    rows.map((f) => f.id),
  );
  return c.json({ formats: rows.map((f) => toResponse(f, latest.get(f.id))) });
});

/**
 * Proposals. The federation/admin sees all pending ones; everybody else sees their own
 * proposals with their state (pending, approved, rejected and the note).
 */
formatRoutes.get('/proposals', requireUser({ active: true }), async (c) => {
  const user = c.get('user');
  if (!user) apiError(401, 'not_logged_in');
  const db = getDb(c.env.DB);
  const reviewer = can.manageRules(user);
  const rows = await db
    .select({ format: formats, username: users.username, displayName: users.displayName })
    .from(formats)
    .leftJoin(users, eq(users.id, formats.createdBy))
    .where(
      reviewer
        ? and(isNull(formats.approvedAt), isNull(formats.archivedAt))
        : eq(formats.createdBy, user.id),
    )
    .orderBy(desc(formats.createdAt))
    .limit(50);
  const latest = await latestVersions(
    db,
    rows.map((r) => r.format.id),
  );
  return c.json({
    proposals: rows
      .filter((r) => reviewer || r.format.approvedAt === null || r.format.createdBy === user.id)
      .map((r) => ({
        ...toResponse(r.format, latest.get(r.format.id)),
        state: proposalState(r.format),
        proposedBy: { username: r.username, displayName: r.displayName },
      })),
  });
});

/** Propose a format. It becomes usable once the federation/admin approves it. */
formatRoutes.post('/proposals', requireUser({ active: true }), async (c) => {
  const user = c.get('user');
  if (!user || !can.battle(user)) apiError(403, 'forbidden');
  const input = await parseJson(c, proposeFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  const open = await db
    .select({ n: count() })
    .from(formats)
    .where(
      and(eq(formats.createdBy, user.id), isNull(formats.approvedAt), isNull(formats.archivedAt)),
    )
    .get();
  if ((open?.n ?? 0) >= MAX_OPEN_PROPOSALS) apiError(429, 'too_many_open_proposals');

  const id = newId(now);
  await insertFormat(
    db,
    id,
    {
      ...input,
      slug: await uniqueSlug(db, input.name),
      status: 'fun',
      createdBy: user.id,
      approved: false,
    },
    [],
    now,
  );
  const format = await loadFormat(db, id);
  return c.json(
    { proposal: { ...toResponse(format, await latestFormatVersion(db, id)), state: 'pending' } },
    201,
  );
});

/**
 * Ranking of one format (rating specification §8.1): sorted by r − 2·RD with inactivity,
 * provisional ratings included and flagged. Only for logged-in users.
 */
formatRoutes.get('/:id/ranking', requireUser({ active: true }), async (c) => {
  const db = getDb(c.env.DB);
  const format = await loadFormat(db, c.req.param('id'));
  const [rows, params] = await Promise.all([
    db
      .select({ state: ratingStates, username: users.username, displayName: users.displayName })
      .from(ratingStates)
      .innerJoin(users, eq(users.id, ratingStates.userId))
      .where(and(eq(ratingStates.formatId, format.id), eq(users.status, 'active'))),
    displayParams(db),
  ]);
  const now = Date.now();
  const entries = rows
    .map((row) => ({
      userId: row.state.userId,
      username: row.username,
      displayName: row.displayName,
      ...ratingView(row.state, params, now),
    }))
    .sort((a, b) => b.rankingValue - a.rankingValue || a.username.localeCompare(b.username))
    .map((entry, i) => ({ rank: i + 1, ...entry }));
  return c.json({ format: { id: format.id, name: format.name }, ranking: entries });
});

/** One format with all its versions (also archived formats and proposals). */
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

/** Create a format directly (federation/admin); it is approved at once. */
formatRoutes.post('/', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, createFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();

  let slug = input.slug;
  if (slug) {
    const taken = await db
      .select({ id: formats.id })
      .from(formats)
      .where(eq(formats.slug, slug))
      .get();
    if (taken) apiError(409, 'slug_taken');
  } else {
    slug = await uniqueSlug(db, input.name);
  }

  const id = newId(now);
  await insertFormat(
    db,
    id,
    { ...input, slug, createdBy: actor.id, approved: true },
    [
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
    ],
    now,
  );
  const format = await loadFormat(db, id);
  return c.json({ format: toResponse(format, await latestFormatVersion(db, id)) }, 201);
});

/** Approve a proposal as official (`relevant`) or other (`fun`). */
formatRoutes.post('/:id/approve', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, approveFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const format = await loadFormat(db, c.req.param('id'));
  if (proposalState(format) !== 'pending') apiError(409, 'not_pending');
  await db.batch([
    db
      .update(formats)
      .set({
        approvedAt: now,
        approvedBy: actor.id,
        status: input.status,
        reviewNote: input.note ?? null,
      })
      .where(eq(formats.id, format.id)),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'format.approve',
        targetType: 'format',
        targetId: format.id,
        payload: input,
      },
      now,
    ),
  ]);
  return c.json({
    format: toResponse(await loadFormat(db, format.id), await latestFormatVersion(db, format.id)),
  });
});

/** Reject a proposal with a note for the proposer. */
formatRoutes.post('/:id/reject', requireUser({ active: true }), async (c) => {
  const actor = c.get('user');
  if (!actor || !can.manageRules(actor)) apiError(403, 'forbidden');
  const input = await parseJson(c, rejectFormatRequestSchema);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const format = await loadFormat(db, c.req.param('id'));
  if (proposalState(format) !== 'pending') apiError(409, 'not_pending');
  await db.batch([
    db
      .update(formats)
      .set({ archivedAt: now, reviewNote: input.note })
      .where(eq(formats.id, format.id)),
    auditInsert(
      db,
      {
        actorId: actor.id,
        action: 'format.reject',
        targetType: 'format',
        targetId: format.id,
        reason: input.note,
      },
      now,
    ),
  ]);
  return c.json({ ok: true });
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
