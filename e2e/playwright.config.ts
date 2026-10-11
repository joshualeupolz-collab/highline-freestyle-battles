import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real app: the built PWA and the API, both served by a local Worker
 * (`wrangler dev`) with its own empty D1 database and R2 bucket in `e2e/.state`.
 * Run: `pnpm e2e` (builds the web app first). Guide: e2e/README.md.
 */
const PORT = 8790;
const api = fileURLToPath(new URL('../apps/api', import.meta.url));
const state = fileURLToPath(new URL('./.state', import.meta.url));

export default defineConfig({
  testDir: './tests',
  // The tests share one database; each test creates its own users, so order does not matter,
  // but parallel recording and uploading on one machine only makes timing flaky.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    ...devices['Pixel 7'],
    // A moving test picture instead of a camera, and no permission prompts.
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      // Locally a preinstalled Chromium can be used: PW_CHROMIUM=/path/to/chrome pnpm e2e
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
    permissions: ['camera', 'microphone'],
    // The service worker would cache the app between tests and adds nothing here.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    // Fresh state for every run: empty database with all migrations, then the Worker.
    command: [
      `rm -rf "${state}"`,
      `pnpm exec wrangler d1 migrations apply DB --local --persist-to "${state}"`,
      `pnpm exec wrangler dev --port ${PORT} --persist-to "${state}"` +
        // Without an R2 access key, uploads go through the Worker into the local bucket.
        ' --var PASSWORD_PEPPER:e2e-pepper --var SETUP_TOKEN:e2e-setup-token',
    ].join(' && '),
    cwd: api,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { CI: '1' },
  },
});
