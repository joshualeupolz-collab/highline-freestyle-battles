import { isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import { formats, formatVersions } from '../db/schema';
import type { AppEnv } from '../env';

export const formatRoutes = new Hono<AppEnv>();

/** All formats that are not archived, each with the parts of its latest version. */
formatRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const [rows, versions] = await Promise.all([
    db.select().from(formats).where(isNull(formats.archivedAt)).orderBy(formats.name),
    db.select().from(formatVersions),
  ]);

  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    const current = latest.get(v.formatId);
    if (!current || v.version > current.version) latest.set(v.formatId, v);
  }

  return c.json({
    formats: rows.map((f) => {
      const version = latest.get(f.id);
      return {
        id: f.id,
        slug: f.slug,
        name: f.name,
        description: f.description,
        status: f.status,
        kPoints: f.kPoints,
        mergedInto: f.mergedInto,
        version: version?.version ?? null,
        parts: version ? (JSON.parse(version.partsJson) as unknown) : [],
      };
    }),
  });
});
