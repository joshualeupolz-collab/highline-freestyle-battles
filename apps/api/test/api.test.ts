import { env } from 'cloudflare:workers';
import { DEFAULT_RULESET_PARAMS } from '@hfb/rating';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const app = createApp();
const get = (path: string) => app.request(path, {}, env);

describe('API', () => {
  it('reports health including the database', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('lists the three launch formats with their parts', async () => {
    const res = await get('/api/formats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      formats: { slug: string; status: string; version: number; parts: unknown }[];
    };
    expect(body.formats.map((f) => [f.slug, f.status, f.version, f.parts])).toEqual([
      ['bounce-combo-10', 'relevant', 1, [{ kind: 'bounce_combo', count: 10 }]],
      ['trick-combo-3', 'relevant', 1, [{ kind: 'trick_combo', count: 3 }]],
      ['best-trick', 'relevant', 1, [{ kind: 'best_trick', count: 1 }]],
    ]);
  });

  it('serves RuleSet 1 with exactly the parameters of the rating engine', async () => {
    const res = await get('/api/rulesets/current');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; params: unknown };
    expect(body.version).toBe(1);
    expect(body.params).toEqual(JSON.parse(JSON.stringify(DEFAULT_RULESET_PARAMS)));
    expect((await get('/api/rulesets/1')).status).toBe(200);
    expect((await get('/api/rulesets/2')).status).toBe(404);
  });

  it('answers unknown routes with JSON 404', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
