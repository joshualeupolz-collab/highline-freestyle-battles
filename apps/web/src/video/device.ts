/**
 * Device code and reservations for offline recording (concept section 6, decided 2026-10-12).
 *
 * Every installation of the app and every browser gets its own random device code, stored on the
 * device; deleting the app or its data gives a new one. While online, the device can reserve
 * attempts ("Prepare for offline recording"); reserved attempts count as used at once. Offline,
 * each recording uses one of them. Back online, the upload queue registers the recordings and
 * reports back (see uploadQueue.ts).
 *
 * The reservations this device holds are kept here too, so they are known offline (also on the
 * friend's page `/film`, which has no battle data of its own).
 */

const DEVICE_KEY = 'hfb-device';
const RESERVATIONS_KEY = 'hfb-reservations';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: offline recording cannot be prepared then.
  }
}

let cached: string | null = null;

/** This device's code (created on first use). */
export function deviceCode(): string {
  if (cached) return cached;
  let code = read(DEVICE_KEY);
  if (!code || !/^[A-Za-z0-9_-]{8,64}$/.test(code)) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    write(DEVICE_KEY, code);
  }
  cached = code;
  return code;
}

/** What a friend's device needs to film offline for the athlete (no battle data otherwise). */
export interface GuestReservationInfo {
  code: string;
  athleteName: string;
  recorderName?: string;
  formatName: string;
  opponents: string[];
  partTexts: string[];
}

/** A reservation held by this device. */
export interface LocalReservation {
  id: string;
  battleId: string;
  partIndex: number;
  round: number;
  /** Reserved units (0 = nothing was free: recordings are provisional). */
  count: number;
  takeover: boolean;
  createdAt: number;
  deadlineAt: number | null;
  /** Something was recorded offline under it: report back once online. */
  needsReport: boolean;
  /** Recordings started under it on this device. */
  recorded?: number;
  /** Set when filming for a friend with their athlete code. */
  guest?: GuestReservationInfo;
}

export function localReservations(): LocalReservation[] {
  try {
    const stored = read(RESERVATIONS_KEY);
    return stored ? (JSON.parse(stored) as LocalReservation[]) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/** Called when this device's reservations changed. */
export function onReservationsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save(list: LocalReservation[]) {
  write(RESERVATIONS_KEY, JSON.stringify(list));
  for (const listener of listeners) listener();
}

export function addLocalReservations(added: LocalReservation[]) {
  const ids = new Set(added.map((r) => r.id));
  save([...localReservations().filter((r) => !ids.has(r.id)), ...added]);
}

export function updateLocalReservation(id: string, change: Partial<LocalReservation>) {
  save(localReservations().map((r) => (r.id === id ? { ...r, ...change } : r)));
}

/** A recording started under this reservation (offline: report back once online). */
export function countRecording(id: string, offline: boolean) {
  save(
    localReservations().map((r) =>
      r.id === id
        ? { ...r, recorded: (r.recorded ?? 0) + 1, needsReport: r.needsReport || offline }
        : r,
    ),
  );
}

export function removeLocalReservation(id: string) {
  save(localReservations().filter((r) => r.id !== id));
}

/**
 * The reservation a new recording of this battle part uses on this device: the athlete's own,
 * or, with `guestCode`, the one made on the friend's page with that code.
 */
export function reservationFor(
  battleId: string,
  partIndex: number,
  guestCode?: string,
): LocalReservation | undefined {
  return localReservations().find(
    (r) =>
      r.battleId === battleId &&
      r.partIndex === partIndex &&
      (guestCode ? r.guest?.code === guestCode : !r.guest),
  );
}
