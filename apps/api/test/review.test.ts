import { env } from 'cloudflare:workers';
import { REVIEW_DAYS } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { reviewOutcome, voteScore } from '../src/battles/review';
import { getDb } from '../src/db/client';
import { resolveExpiredReviews } from '../src/services/review';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const DAY = 86_400_000;

interface Battle {
  id: string;
  status: string;
  decisionReason: string | null;
  cancelReason: string | null;
  participants: { userId: string; seat: number; score: number | null }[];
  review: {
    endsAt: number;
    voted: string[];
    votes: { userId: string; value: number }[];
  } | null;
  ratingChanges: { userId: string; before: number; after: number }[];
}

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let anna: Person;
let ben: Person;
let carla: Person;

beforeEach(async () => {
  const admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
  carla = await registerAthlete('carla', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

const post = (who: Person, path: string, body?: unknown) =>
  json<{ battle: Battle; error?: string }>(
    call(path, { method: 'POST', session: who.session, body }),
  );

const get = (who: Person, id: string) =>
  json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: who.session }));

/** Anna (seat 0) vs Ben (seat 1), both videos submitted (the upload flow is in videos.test.ts). */
async function battleInReview(settings: Record<string, unknown> = {}, playedAgoMs = 0) {
  const created = await post(anna, '/api/battles', { formatId: BEST_TRICK, settings });
  const id = created.body.battle.id;
  await post(ben, `/api/battles/${id}/accept`);
  await env.DB.prepare("UPDATE battles SET status = 'reviewing', played_at = ? WHERE id = ?")
    .bind(Date.now() - playedAgoMs, id)
    .run();
  return id;
}

const vote = (who: Person, id: string, value: number) =>
  post(who, `/api/battles/${id}/vote`, { value });

describe('review rules', () => {
  it('maps votes to scores and needs both on one side', () => {
    expect([2, 1, 0, -1, -2].map((v) => voteScore(v, 'scale'))).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect([2, 1, -1].map((v) => voteScore(v, 'win_loss'))).toEqual([1, 1, 0]);
    expect(reviewOutcome([2, 1], 'scale', false)).toEqual({ kind: 'decided', seat0Score: 0.875 });
    expect(reviewOutcome([-1, -1], 'scale', false)).toEqual({ kind: 'decided', seat0Score: 0.25 });
    expect(reviewOutcome([2, 1], 'win_loss', false)).toEqual({ kind: 'decided', seat0Score: 1 });
    expect(reviewOutcome([1, -1], 'scale', false).kind).toBe('open');
    // No draw in stage 1: both "can't decide" is no agreement.
    expect(reviewOutcome([0, 0], 'scale', false).kind).toBe('open');
    expect(reviewOutcome([0, 0], 'scale', true).kind).toBe('no_agreement');
    expect(reviewOutcome([1], 'scale', false).kind).toBe('open');
    expect(reviewOutcome([-2], 'scale', true)).toEqual({ kind: 'decided', seat0Score: 0 });
    expect(reviewOutcome([0], 'scale', true).kind).toBe('no_agreement');
    expect(reviewOutcome([], 'scale', true).kind).toBe('no_agreement');
  });
});

describe('voting', () => {
  it('decides the battle and updates the ratings once both agree', async () => {
    const id = await battleInReview();
    const first = await vote(anna, id, 2);
    expect(first.status).toBe(200);
    expect(first.body.battle.status).toBe('reviewing');

    // Ben only sees that Anna voted, not how.
    const benView = await get(ben, id);
    expect(benView.body.battle.review?.voted).toEqual([anna.user.id]);
    expect(benView.body.battle.review?.votes).toEqual([]);

    const second = await vote(ben, id, 1);
    const battle = second.body.battle;
    expect(battle.status).toBe('decided');
    expect(battle.decisionReason).toBe('review');
    expect(battle.participants.map((p) => p.score)).toEqual([0.875, 0.125]);
    expect(battle.review?.votes).toHaveLength(2);
    const change = battle.ratingChanges.find((r) => r.userId === anna.user.id);
    expect(change && change.after > change.before).toBe(true);
    // Voting again is not possible.
    expect((await vote(anna, id, -2)).body.error).toBe('not_in_review');
  });

  it('shows both votes on disagreement and lets people change theirs', async () => {
    const id = await battleInReview();
    await vote(anna, id, 1);
    const disagreed = await vote(ben, id, -1);
    expect(disagreed.body.battle.status).toBe('reviewing');
    expect(disagreed.body.battle.review?.votes).toHaveLength(2);
    const changed = await vote(ben, id, 1);
    expect(changed.body.battle.status).toBe('decided');
    expect(changed.body.battle.participants.map((p) => p.score)).toEqual([0.75, 0.25]);
  });

  it('gives 1 / 0 for win/loss battles', async () => {
    const id = await battleInReview({ scoring: 'win_loss' });
    await vote(anna, id, -1);
    const res = await vote(ben, id, -2);
    expect(res.body.battle.participants.map((p) => p.score)).toEqual([0, 1]);
  });

  it('refuses outsiders and battles that are not in review', async () => {
    const id = await battleInReview();
    expect((await vote(carla, id, 1)).status).toBe(403);
    const created = await post(anna, '/api/battles', { formatId: BEST_TRICK });
    expect((await vote(anna, created.body.battle.id, 1)).body.error).toBe('not_in_review');
    expect((await post(anna, `/api/battles/${id}/vote`, { value: 3 })).status).toBe(400);
  });
});

describe('when the review time is over', () => {
  const late = (REVIEW_DAYS + 1) * DAY;

  it('lets a single vote for one side decide', async () => {
    const id = await battleInReview({}, late);
    await vote(ben, id, -2);
    expect(await resolveExpiredReviews(getDb(env.DB))).toBe(1);
    const battle = (await get(anna, id)).body.battle;
    expect(battle.status).toBe('decided');
    expect(battle.participants.map((p) => p.score)).toEqual([0, 1]);
  });

  it('ends the battle unrated without agreement', async () => {
    const id = await battleInReview({}, late);
    await vote(anna, id, 1);
    await vote(ben, id, -1);
    const silent = await battleInReview({}, late);
    const fresh = await battleInReview();
    expect(await resolveExpiredReviews(getDb(env.DB))).toBe(2);
    for (const battleId of [id, silent]) {
      const battle = (await get(anna, battleId)).body.battle;
      expect(battle.status).toBe('cancelled');
      expect(battle.cancelReason).toBe('no_agreement');
    }
    expect((await get(anna, fresh)).body.battle.status).toBe('reviewing');
  });
});
