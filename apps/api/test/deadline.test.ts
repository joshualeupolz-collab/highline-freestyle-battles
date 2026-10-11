/** Deadlines at 05:00 German time, also across the switch between summer and winter time. */
import { checkDeadline, defaultDeadline, zonedTimeToUtc } from '@hfb/shared';
import { describe, expect, it } from 'vitest';

describe('deadlines', () => {
  it('defaults to 05:00 German time in 7 days (summer time: 03:00 UTC)', () => {
    expect(new Date(defaultDeadline(Date.UTC(2026, 9, 11, 12))).toISOString()).toBe(
      '2026-10-18T03:00:00.000Z',
    );
  });

  it('handles the switch to winter time (05:00 CET = 04:00 UTC)', () => {
    expect(new Date(defaultDeadline(Date.UTC(2026, 9, 22, 12))).toISOString()).toBe(
      '2026-10-29T04:00:00.000Z',
    );
  });

  it('handles the switch to summer time', () => {
    expect(new Date(defaultDeadline(Date.UTC(2027, 2, 25, 12))).toISOString()).toBe(
      '2027-04-01T03:00:00.000Z',
    );
  });

  it('uses the German date: just after midnight in Germany counts as the next day', () => {
    // 22:30 UTC on 11 Oct is already 00:30 on 12 Oct in Germany → deadline 19 Oct 05:00.
    expect(new Date(defaultDeadline(Date.UTC(2026, 9, 11, 22, 30))).toISOString()).toBe(
      '2026-10-19T03:00:00.000Z',
    );
  });

  it('converts German wall-clock time to UTC', () => {
    expect(zonedTimeToUtc(2026, 12, 24, 18, 0)).toBe(Date.UTC(2026, 11, 24, 17, 0));
  });

  it('accepts no deadline and refuses deadlines in the past or too far away', () => {
    const now = Date.UTC(2026, 9, 11);
    expect(checkDeadline(null, now)).toBeNull();
    expect(checkDeadline(now + 3_600_000, now)).toBeNull();
    expect(checkDeadline(now - 1, now)).toBe('deadline_in_past');
    expect(checkDeadline(now + 61 * 86_400_000, now)).toBe('deadline_too_far');
  });
});
