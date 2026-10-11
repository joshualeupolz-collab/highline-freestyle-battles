import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside the real Workers runtime (Miniflare) with a local D1 database.
// All migrations from db/migrations are applied before each test file.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('../../db/migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Test-only values; real secrets are set with `wrangler secret put`.
            PASSWORD_PEPPER: 'test-pepper',
            SETUP_TOKEN: 'test-setup-token',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
