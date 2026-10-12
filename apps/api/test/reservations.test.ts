/**
 * Offline recording with reserved attempts (concept section 6, decided 2026-10-12): reserving
 * uses up attempts at once, reporting back hands the unused ones back, a take-over stays
 * provisional, lost devices are counted, and the grace period after the deadline.
 */
import { env } from 'cloudflare:workers';
import { newId } from '@hfb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const BEST_TRICK = '01a12842-5c02-7d6b-bce2-b6212ef6a4df';
const PHONE = 'phone-aaaaaaaa';
const TABLET = 'tablet-bbbbbbbb';
const FRIEND = 'friend-cccccccc';

interface Reservation {
  id: string;
  userId: string;
  count: number;
  used: number;
  takeover: boolean;
  closedAt: number | null;
  deviceCode: string | null;
  deviceLabel: string;
  friend: { name: string | null } | null;
}
interface Battle {
  id: string;
  status: string;
  participants: { userId: string; lostReservations: number }[];
  proposals: { id: string }[];
  videos: {
    slots: { userId: string; attempts: number; provisional: number }[];
    mine: { id: string; provisional: boolean; reservationId: string | null }[];
    reservations: Reservation[];
  };
}

type Person = Awaited<ReturnType<typeof registerAthlete>>;
let admin: Person;
let anna: Person;
let ben: Person;

beforeEach(async () => {
  admin = await registerAdmin();
  anna = await registerAthlete('anna', admin.session);
  ben = await registerAthlete('ben', admin.session);
});

async function json<T>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}
const post = <T = { battle: Battle; error?: string }>(
  who: Person | null,
  path: string,
  body?: unknown,
) => json<T>(call(path, { method: 'POST', session: who?.session, body }));
const view = async (who: Person, id: string) =>
  (await json<{ battle: Battle }>(call(`/api/battles/${id}`, { session: who.session }))).body
    .battle;

async function activeBattle(settings: Record<string, unknown> = { attemptsPerVideo: 3 }) {
  const res = await post(anna, '/api/battles', { formatId: BEST_TRICK, settings });
  await post(ben, `/api/battles/${res.body.battle.id}/accept`);
  return res.body.battle.id;
}

const reserve = (who: Person, id: string, count: number, deviceCode = PHONE) =>
  post(who, `/api/battles/${id}/reservations`, {
    deviceCode,
    parts: [{ partIndex: 0, count }],
  });

const record = (
  who: Person,
  id: string,
  startedAt: number,
  extra: { deviceCode?: string; reservationId?: string } = {},
) => post(who, `/api/battles/${id}/attempts`, { id: newId(), partIndex: 0, startedAt, ...extra });

const report = (
  who: Person,
  id: string,
  reservationId: string,
  handBack: boolean,
  deviceCode = PHONE,
) => post(who, `/api/battles/${id}/reservations/${reservationId}/report`, { deviceCode, handBack });

describe('reserving attempts for offline recording', () => {
  it('uses up attempts at once and hands the unused ones back after reporting', async () => {
    const id = await activeBattle();
    const reserved = await reserve(anna, id, 2);
    expect(reserved.status, reserved.body.error).toBe(201);
    const r = reserved.body.battle.videos.reservations[0] as Reservation;
    expect(r).toMatchObject({ count: 2, takeover: false, closedAt: null, deviceCode: PHONE });

    // Ben sees the reservation, but not the device code.
    const benR = (await view(ben, id)).videos.reservations[0];
    expect(benR).toMatchObject({ count: 2, deviceCode: null, deviceLabel: 'phon' });

    // One attempt free online; a second one is provisional (two are reserved).
    const t0 = Date.now();
    expect((await record(anna, id, t0)).status).toBe(201);
    const beyond = await record(anna, id, t0 + 1);
    expect(beyond.body.battle.videos.mine.map((m) => m.provisional)).toEqual([false, true]);

    // Offline on the phone: one attempt under the reservation, then back online.
    const offline = await record(anna, id, t0 + 2, { deviceCode: PHONE, reservationId: r.id });
    expect(offline.body.battle.videos.mine.at(-1)).toMatchObject({
      provisional: false,
      reservationId: r.id,
    });
    const first = await report(anna, id, r.id, false);
    expect(first.body.battle.videos.reservations[0]).toMatchObject({ used: 1, closedAt: null });
    // Handing back frees the unused unit: the provisional attempt becomes valid.
    const back = await report(anna, id, r.id, true);
    expect(back.body.battle.videos.reservations[0]).toMatchObject({ count: 1, used: 1 });
    expect(back.body.battle.videos.mine.every((m) => !m.provisional)).toBe(true);
  });

  it('refuses a reservation id of another device', async () => {
    const id = await activeBattle();
    const r = (await reserve(anna, id, 1)).body.battle.videos.reservations[0] as Reservation;
    const res = await record(anna, id, Date.now(), { deviceCode: TABLET, reservationId: r.id });
    expect(res.body.error).toBe('reservation_mismatch');
    expect((await report(anna, id, r.id, true, TABLET)).status).toBe(404);
    expect((await report(ben, id, r.id, true)).status).toBe(404);
  });

  it('a take-over stays provisional until the original device reports', async () => {
    const id = await activeBattle();
    const phone = (await reserve(anna, id, 3)).body.battle.videos.reservations[0] as Reservation;
    // The phone's battery died: the tablet takes over (nothing free any more).
    const taken = await reserve(anna, id, 3, TABLET);
    const tablet = taken.body.battle.videos.reservations[1] as Reservation;
    expect(tablet).toMatchObject({ count: 0, takeover: true });

    const t0 = Date.now();
    for (let i = 0; i < 3; i++)
      await record(anna, id, t0 + i, { deviceCode: TABLET, reservationId: tablet.id });
    expect((await view(anna, id)).videos.mine.map((m) => m.provisional)).toEqual([
      true,
      true,
      true,
    ]);

    // The phone comes back having recorded one attempt: the tablet's first two become valid.
    await record(anna, id, t0 - 1000, { deviceCode: PHONE, reservationId: phone.id });
    const reported = await report(anna, id, phone.id, true);
    expect(reported.body.battle.videos.mine.map((m) => m.provisional)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('counts reservations never reported once the battle ended', async () => {
    const id = await activeBattle();
    await reserve(anna, id, 2);
    await post(anna, `/api/battles/${id}/proposals`, { kind: 'cancel' });
    const proposalId = (await view(ben, id)).proposals[0]?.id;
    await post(ben, `/api/battles/${id}/proposals/${proposalId}/respond`, { decision: 'accept' });

    const next = await activeBattle();
    const seen = await view(ben, next);
    expect(seen.participants.find((p) => p.userId === anna.user.id)?.lostReservations).toBe(1);
    // On the profile only for the federation and admins.
    const profile = (who: Person) =>
      json<{ user: { lostReservations: number | null } }>(
        call(`/api/users/${anna.user.id}`, { session: who.session }),
      );
    expect((await profile(admin)).body.user.lostReservations).toBe(1);
    expect((await profile(ben)).body.user.lostReservations).toBeNull();
  });

  it('friends reserve with the athlete code', async () => {
    const id = await activeBattle();
    const code = (
      await json<{ code: string }>(call('/api/athlete-code', { session: anna.session }))
    ).body.code;
    const res = await post<{ reservations: { id: string; count: number }[]; error?: string }>(
      null,
      '/api/guest/reservations',
      {
        code,
        deviceCode: FRIEND,
        battleId: id,
        recorderName: 'Max',
        parts: [{ partIndex: 0, count: 5 }],
      },
    );
    expect(res.status, res.body.error).toBe(201);
    const r = res.body.reservations[0];
    expect(r?.count).toBe(3);

    const attempt = await post<{ ok: boolean; error?: string }>(null, '/api/guest/attempts', {
      code,
      id: newId(),
      battleId: id,
      partIndex: 0,
      startedAt: Date.now(),
      deviceCode: FRIEND,
      reservationId: r?.id,
    });
    expect(attempt.status, attempt.body.error).toBe(201);
    const done = await post<{ reservation: { count: number; closedAt: number | null } }>(
      null,
      `/api/guest/reservations/${r?.id}/report`,
      { code, deviceCode: FRIEND, handBack: true },
    );
    expect(done.body.reservation.count).toBe(1);
    expect(done.body.reservation.closedAt).not.toBeNull();
    const seen = await view(anna, id);
    expect(seen.videos.reservations[0]?.friend).toEqual({ name: 'Max' });
    expect(seen.videos.mine[0]?.provisional).toBe(false);
  });
});

describe('grace period after the deadline', () => {
  const expire = (id: string, ago: number) =>
    env.DB.prepare('UPDATE battles SET deadline_at = ? WHERE id = ?')
      .bind(Date.now() - ago, id)
      .run();

  it('the delivering side waits while the other side may still deliver', async () => {
    const id = await activeBattle({ attemptsPerVideo: 1 });
    // Ben delivers.
    const b = await record(ben, id, Date.now());
    const attemptId = b.body.battle.videos.mine[0]?.id as string;
    const created = await post<{ video: { id: string } }>(ben, '/api/videos', {
      attemptId,
      contentType: 'video/mp4',
      sizeBytes: 3,
    });
    await env.VIDEOS.put(`videos/${created.body.video.id}/original.mp4`, new Uint8Array([1, 2, 3]));
    await post(ben, `/api/videos/${created.body.video.id}/complete`);
    expect(
      (await post(ben, `/api/battles/${id}/submissions`, { videoId: created.body.video.id }))
        .status,
    ).toBe(200);
    // Anna reserved and went offline.
    await reserve(anna, id, 1);
    await expire(id, 3600_000);

    const early = await post(ben, `/api/battles/${id}/deadline-decision`, { choice: 'claim_win' });
    expect(early.body.error).toBe('others_may_still_deliver');
    await expire(id, 8 * 86_400_000);
    const late = await post(ben, `/api/battles/${id}/deadline-decision`, { choice: 'claim_win' });
    expect(late.body.battle.status).toBe('decided');
  });
});
