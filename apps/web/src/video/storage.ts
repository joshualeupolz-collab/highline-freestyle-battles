/**
 * Local video storage in IndexedDB. Every recorder chunk (about one second) is written as soon as
 * it arrives, so a recording survives a crash or a closed tab up to the last chunk.
 * Chunks are stored as ArrayBuffers: older Safari versions cannot store Blobs in IndexedDB.
 */

export type RecordingStatus = 'recording' | 'done' | 'interrupted';

/**
 * Why a recording ended. Leaving the app ends the attempt (concept section 6): the camera stops
 * in the background, and pausing would allow hiding a fall. The cut-off video can later be sent
 * to the opponent with a request for an extra attempt.
 */
export type EndReason = 'stopped' | 'app_left' | 'camera_lost';

export interface StoredRecording {
  id: string;
  createdAt: number;
  status: RecordingStatus;
  endReason?: EndReason;
  /** Which attempt of the test series this was (pressing Start uses up an attempt). */
  attempt: number;
  quality: string;
  /** MIME type the recorder actually used. */
  mimeType: string;
  chunkCount: number;
  bytes: number;
  /** Wall-clock time from start to stop. */
  durationMs: number;
  /** Everything useful for the test report (requested vs actual settings, chunk timing, errors). */
  diagnostics: Record<string, unknown>;
  /** Set for battle recordings; the recording id is then the attempt id. Missing on the test page. */
  battle?: BattleAttempt;
  /** Set when filming for a friend with their athlete code (no account needed). */
  guest?: GuestAttempt;
  /** Upload state of a battle or guest recording (see uploadQueue.ts). */
  upload?: UploadState;
}

/** Filming for a friend: the attempt belongs to the athlete whose code was entered. */
export interface GuestAttempt {
  code: string;
  /** The athlete's name, as shown when the code was entered (empty if entered offline). */
  athleteName: string;
  battleId: string;
  partIndex: number;
  round: number;
  recorderName?: string;
  /** Recorded under this device's reservation (offline recording, see device.ts). */
  reservationId?: string;
  /** The server knows about the attempt. */
  synced: boolean;
}

export interface BattleAttempt {
  battleId: string;
  partIndex: number;
  round: number;
  /** Recorded under this device's reservation (offline recording, see device.ts). */
  reservationId?: string;
  /** The server knows about the attempt (it counts towards the limit there too). */
  synced: boolean;
}

export interface UploadState {
  /**
   * waiting: recorded, the athlete has not decided on the cut yet;
   * queued: will be uploaded as soon as there is a connection;
   * done: on the server, the local copy can go; failed: the server refused it (see error).
   */
  state: 'waiting' | 'queued' | 'done' | 'failed';
  /** Cut points in seconds (start/end of the recording if not set). */
  trimStart?: number;
  trimEnd?: number;
  visibility: 'public' | 'logged_in' | 'review_only';
  keep: boolean;
  /** Ask the opponent for an extra attempt and show them this video (cut-off recordings). */
  askExtraAttempt?: boolean;
  videoId?: string;
  error?: string;
  /** 0–1 while bytes are being sent. */
  progress?: number;
}

const DB_NAME = 'hfb-video';
const RECORDINGS = 'recordings';
const CHUNKS = 'chunks';

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      d.createObjectStore(RECORDINGS, { keyPath: 'id' });
      d.createObjectStore(CHUNKS, { keyPath: ['recordingId', 'index'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const listeners = new Set<() => void>();

/** Called after every change to a recording record (to refresh lists and upload progress). */
export function onRecordingsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

export async function saveRecording(recording: StoredRecording): Promise<void> {
  const tx = (await db()).transaction(RECORDINGS, 'readwrite');
  tx.objectStore(RECORDINGS).put(recording);
  await done(tx);
  changed();
}

export async function getRecording(id: string): Promise<StoredRecording | undefined> {
  const tx = (await db()).transaction(RECORDINGS, 'readonly');
  return result(tx.objectStore(RECORDINGS).get(id) as IDBRequest<StoredRecording | undefined>);
}

/** Changes some fields of a stored recording (no-op if it is gone). */
export async function updateRecording(
  id: string,
  change: (recording: StoredRecording) => StoredRecording,
): Promise<StoredRecording | undefined> {
  const current = await getRecording(id);
  if (!current) return undefined;
  const next = change(current);
  await saveRecording(next);
  return next;
}

export async function addChunk(
  recordingId: string,
  index: number,
  data: ArrayBuffer,
): Promise<void> {
  const tx = (await db()).transaction(CHUNKS, 'readwrite');
  tx.objectStore(CHUNKS).put({ recordingId, index, data });
  await done(tx);
}

export async function listRecordings(): Promise<StoredRecording[]> {
  const tx = (await db()).transaction(RECORDINGS, 'readonly');
  const all = await result(tx.objectStore(RECORDINGS).getAll() as IDBRequest<StoredRecording[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

function chunkRange(recordingId: string): IDBKeyRange {
  return IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
}

/** All chunks of a recording joined into one file. */
export async function loadRecordingBytes(recordingId: string): Promise<Uint8Array> {
  const tx = (await db()).transaction(CHUNKS, 'readonly');
  const chunks = await result(
    tx.objectStore(CHUNKS).getAll(chunkRange(recordingId)) as IDBRequest<
      { index: number; data: ArrayBuffer }[]
    >,
  );
  chunks.sort((a, b) => a.index - b.index);
  let size = 0;
  for (const c of chunks) size += c.data.byteLength;
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c.data), o);
    o += c.data.byteLength;
  }
  return out;
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const tx = (await db()).transaction([RECORDINGS, CHUNKS], 'readwrite');
  tx.objectStore(RECORDINGS).delete(recordingId);
  tx.objectStore(CHUNKS).delete(chunkRange(recordingId));
  await done(tx);
  changed();
}

/** Removes the video bytes but keeps the record (after a successful upload). */
export async function deleteChunks(recordingId: string): Promise<void> {
  const tx = (await db()).transaction(CHUNKS, 'readwrite');
  tx.objectStore(CHUNKS).delete(chunkRange(recordingId));
  await done(tx);
}

/**
 * Recordings still marked "recording" when the page loads were cut off (crash, closed tab,
 * phone call). They keep their chunks and are marked as interrupted.
 */
export async function markInterruptedRecordings(): Promise<number> {
  let count = 0;
  for (const r of await listRecordings()) {
    if (r.status !== 'recording' || r.battle || r.guest) continue;
    await saveRecording({ ...r, status: 'interrupted' });
    count++;
  }
  return count;
}

/** Asks the browser not to evict our data when storage runs low (iOS deletes it otherwise). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{
  usage?: number;
  quota?: number;
  persisted?: boolean;
}> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      usage: estimate?.usage,
      quota: estimate?.quota,
      persisted: await navigator.storage?.persisted?.(),
    };
  } catch {
    return {};
  }
}
