import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = ReturnType<typeof getDb>;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

type Statement = Parameters<Database['batch']>[0][number];

/** Runs statements atomically (all or nothing). D1 has no interactive transactions. */
export async function runBatch(db: Database, statements: Statement[]): Promise<void> {
  const [first, ...rest] = statements;
  if (!first) return;
  await db.batch([first, ...rest]);
}
