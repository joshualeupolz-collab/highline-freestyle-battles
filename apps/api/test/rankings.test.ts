import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const TRICK_COMBO = '01a12842-5c00-701e-b6c0-4a930af3272a';
const BOUNCE_COMBO = '01a12842-5c01-7a3f-afae-5e7aeb8912cb';

type Person = Awaited<ReturnType<typeof registerAthlete>>;

async function setRating(person: Person, formatId: string, r: number) {
  await env.DB.prepare(
    `INSERT INTO rating_states (user_id, format_id, r, rd, sigma, last_event_at, n_battles, ruleset_version, computed_at)
     VALUES (?, ?, ?, 60, 0.06, ?, 10, 1, ?)`,
  )
    .bind(person.user.id, formatId, r, Date.now(), Date.now())
    .run();
}

interface Combined {
  official: boolean;
  dropWorst: number;
  formats: { id: string; name: string }[];
  ranking: { username: string; value: number; z: (number | null)[]; formatsPlayed: number }[];
}
const combined = async (who: Person, query = '') => {
  const res = await call(`/api/rankings/combined${query}`, { session: who.session });
  return { status: res.status, body: (await res.json()) as Combined };
};

describe('combined rankings', () => {
  it('official: all relevant formats, the worst dropped; free: chosen formats and drop', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const ben = await registerAthlete('ben', admin.session);
    // Anna is good in two formats, Ben great in one.
    await setRating(anna, BEST_TRICK, 1750);
    await setRating(anna, TRICK_COMBO, 1750);
    await setRating(ben, BOUNCE_COMBO, 2000);
    await setRating(ben, BEST_TRICK, 1250);

    const official = await combined(anna);
    expect(official.status).toBe(200);
    expect(official.body).toMatchObject({ official: true, dropWorst: 1 });
    expect(official.body.formats).toHaveLength(3);
    expect(official.body.ranking.map((e) => e.username)).toEqual(['anna', 'ben']);
    expect(official.body.ranking[0]?.formatsPlayed).toBe(2);

    // Only Best Trick and Bounce Combo, nothing dropped.
    const free = await combined(anna, `?formats=${BEST_TRICK},${BOUNCE_COMBO}&drop=0`);
    expect(free.body.official).toBe(false);
    expect(free.body.ranking.map((e) => e.z)).toEqual([
      // R = r − 2·RD: 1630 and 1130, mean 1380, fallback spread 250 (few people).
      [1, null], // anna, Bounce Combo never played
      [-1, 0], // ben
    ]);

    expect((await combined(anna, '?formats=nope')).status).toBe(400);
    expect((await combined(anna, `?formats=${BEST_TRICK}&drop=-1`)).status).toBe(400);
    expect((await call('/api/rankings/combined')).status).toBe(401);
  });
});
