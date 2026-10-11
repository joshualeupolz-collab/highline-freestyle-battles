/**
 * Battle deadlines are a fixed point in time (date + time), not a duration: whoever only has
 * time until Sunday picks Sunday, no matter when the request is accepted.
 *
 * The default time is 05:00 German time (Europe/Berlin, CET/CEST): people in the Americas
 * still have the whole previous day, and nobody in Europe gets an extra morning.
 */

export const DEADLINE_TIME_ZONE = 'Europe/Berlin';
export const DEFAULT_DEADLINE_HOUR = 5;
export const DEFAULT_DEADLINE_DAYS = 7;
/** Latest possible deadline, counted from now. */
export const MAX_DEADLINE_DAYS = 60;
/** A deadline must be at least this far in the future. */
export const MIN_DEADLINE_LEAD_MS = 15 * 60_000;

const DAY = 86_400_000;

/** Calendar date and time of an instant in a time zone. */
function wallClock(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** Difference "wall clock in the zone − UTC" at an instant, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(instant / 60_000) * 60_000
  );
}

/** The instant at which the clock in `timeZone` shows the given date and time. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = DEADLINE_TIME_ZONE,
): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - zoneOffset(asUtc, timeZone);
  // Around a clock change the offset can differ between the guess and the result.
  return asUtc - zoneOffset(first, timeZone);
}

/** Default deadline: in DEFAULT_DEADLINE_DAYS days at 05:00 German time. */
export function defaultDeadline(now = Date.now(), days = DEFAULT_DEADLINE_DAYS): number {
  const today = wallClock(now, DEADLINE_TIME_ZONE);
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day) + days * DAY);
  return zonedTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    DEFAULT_DEADLINE_HOUR,
    0,
  );
}

/** null = fine, otherwise an error code. */
export function checkDeadline(deadlineAt: number | null, now = Date.now()): string | null {
  if (deadlineAt === null) return null;
  if (deadlineAt < now + MIN_DEADLINE_LEAD_MS) return 'deadline_in_past';
  if (deadlineAt > now + MAX_DEADLINE_DAYS * DAY) return 'deadline_too_far';
  return null;
}
