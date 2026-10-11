/**
 * Full rating recalculation, run by .github/workflows/replay.yml (or by hand).
 *
 *   pnpm --filter @hfb/api replay            # only if replay requests are open
 *   pnpm --filter @hfb/api replay --force    # always
 *   pnpm --filter @hfb/api replay --local    # against the local database (wrangler dev)
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for the remote database, and the real
 * database id in wrangler.jsonc (the workflow inserts it). Logic: src/services/replay.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeReplay,
  REPLAY_QUERIES,
  type ReplayRows,
  replayStatements,
} from '../src/services/replay';

const args = new Set(process.argv.slice(2));
const target = args.has('--local') ? '--local' : '--remote';

function wrangler(extra: string[]): string {
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', target, ...extra], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function query<T>(sql: string): T[] {
  const out = wrangler(['--json', '--command', sql]);
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed.flatMap((r) => r.results);
}

const startedAt = Date.now();
const requests = query<{ id: string }>(REPLAY_QUERIES.openRequests);
if (requests.length === 0 && !args.has('--force')) {
  console.log('No open replay requests; nothing to do.');
  process.exit(0);
}

const rows: ReplayRows = {
  battles: query(REPLAY_QUERIES.battles),
  estimates: query(REPLAY_QUERIES.estimates),
  rulesets: query(REPLAY_QUERIES.rulesets),
  formats: query(REPLAY_QUERIES.formats),
};
const result = computeReplay(rows);
const statements = replayStatements(
  result,
  requests.map((r) => r.id),
  Date.now(),
);
const file = join(mkdtempSync(join(tmpdir(), 'hfb-replay-')), 'replay.sql');
writeFileSync(file, `${statements.join('\n')}\n`);
wrangler(['--yes', '--file', file]);
console.log(
  `Replayed ${result.history.length / 2} battles, ${result.states.length} ratings; closed ${requests.length} request(s).`,
);

// Battles decided by the Worker while this ran were overwritten: replay again next time.
const [late] = query<{ n: number }>(
  `SELECT COUNT(*) AS n FROM battles WHERE status = 'decided' AND event_at >= ${startedAt}`,
);
if (late && late.n > 0) {
  wrangler([
    '--command',
    `INSERT INTO replay_requests (id, reason, created_at) VALUES ('${crypto.randomUUID()}', 'battles decided during a replay', ${Date.now()})`,
  ]);
  console.log(`${late.n} battle(s) were decided meanwhile; another replay was requested.`);
}
