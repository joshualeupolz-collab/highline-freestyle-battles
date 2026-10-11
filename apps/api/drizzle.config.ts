import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/db/schema.ts. Applied with `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: '../../db/migrations',
});
