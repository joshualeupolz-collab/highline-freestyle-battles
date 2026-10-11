import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env as WorkerEnv } from '../src/env';

// Types for `env` from 'cloudflare:workers' inside the tests.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
