/**
 * Upload queue for battle recordings and recordings made for a friend with their athlete code
 * (concept section 6: "upload happens automatically once there is a connection and the app is
 * open"; iPhones cannot upload in the background).
 *
 * For every battle recording in IndexedDB:
 * 1. the attempt is registered with the server (right after Start, or later when back online);
 * 2. once the athlete has chosen the cut ("queued"), the video is cut without re-encoding, sent to
 *    the upload target the server hands out (signed R2 URL or the Worker) and confirmed;
 * 3. the local copy is deleted.
 * Network errors leave everything queued for the next run; refusals by the server are shown.
 */
import { MAX_VIDEO_BYTES } from '@hfb/shared';
import { ApiError, api } from '../api';
import {
  deleteRecording,
  listRecordings,
  loadRecordingBytes,
  type StoredRecording,
  saveRecording,
  updateRecording,
} from './storage';
import { trimVideo } from './trim';

type Listener = (battleId: string) => void;
const serverListeners = new Set<Listener>();
const progressListeners = new Set<() => void>();
const progress = new Map<string, number>();

/** Called when the server state of a battle changed (attempt registered, video uploaded). */
export function onServerChanged(listener: Listener): () => void {
  serverListeners.add(listener);
  return () => serverListeners.delete(listener);
}

/** Upload progress 0–1 of a recording while its bytes are being sent. */
export function uploadProgress(recordingId: string): number | undefined {
  return progress.get(recordingId);
}

export function onProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function setProgress(id: string, value: number | undefined) {
  if (value === undefined) progress.delete(id);
  else progress.set(id, value);
  for (const listener of progressListeners) listener();
}

let running = false;
let again = false;

/** Process the queue now (does nothing if it is already running, except run once more after). */
export function kickUploads(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = false;
    }
  })();
}

let started = false;

/** Starts the queue once per page load: now, when back online, when the app is shown, every minute. */
export function startUploadQueue(): void {
  if (started || typeof indexedDB === 'undefined') return;
  started = true;
  void markInterruptedBattleRecordings().then(kickUploads);
  window.addEventListener('online', kickUploads);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickUploads();
  });
  setInterval(kickUploads, 60_000);
}

/** Battle recordings still marked "recording" at start-up were cut off by a crash. */
async function markInterruptedBattleRecordings() {
  for (const r of await listRecordings()) {
    if ((r.battle || r.guest) && r.status === 'recording')
      await saveRecording({ ...r, status: 'interrupted' });
  }
}

/** A refusal by the server (not a missing connection or a server hiccup). */
function isRefusal(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401
  );
}

async function runOnce() {
  for (const recording of await listRecordings()) {
    if ((!recording.battle && !recording.guest) || recording.upload?.state === 'failed') continue;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      await process(recording);
    } catch (error) {
      setProgress(recording.id, undefined);
      if (!isRefusal(error)) return; // no connection: try again later
      if (error.code === 'already_uploaded') {
        // Uploaded before, only the local clean-up was missing.
        await deleteRecording(recording.id);
        continue;
      }
      await updateRecording(recording.id, (r) => ({
        ...r,
        upload: {
          ...(r.upload ?? { visibility: 'public', keep: false }),
          state: 'failed',
          error: error.code,
        },
      }));
    }
  }
}

async function process(recording: StoredRecording) {
  if (recording.guest) return processGuest(recording);
  const battle = recording.battle;
  if (!battle) return;
  if (!battle.synced) {
    await api.registerAttempt(battle.battleId, {
      id: recording.id,
      partIndex: battle.partIndex,
      round: battle.round,
      startedAt: recording.createdAt,
    });
    await updateRecording(recording.id, (r) =>
      r.battle ? { ...r, battle: { ...r.battle, synced: true } } : r,
    );
    for (const listener of serverListeners) listener(battle.battleId);
  }
  if (recording.status === 'recording' || recording.upload?.state !== 'queued') return;
  await upload(recording, battle.battleId);
}

/** Filmed for a friend: registered and uploaded with the athlete's code instead of a login. */
async function processGuest(recording: StoredRecording) {
  const guest = recording.guest;
  if (!guest) return;
  if (!guest.synced) {
    await api.guestAttempt({
      code: guest.code,
      id: recording.id,
      battleId: guest.battleId,
      partIndex: guest.partIndex,
      round: guest.round,
      startedAt: recording.createdAt,
      recorderName: guest.recorderName,
    });
    await updateRecording(recording.id, (r) =>
      r.guest ? { ...r, guest: { ...r.guest, synced: true } } : r,
    );
    for (const listener of serverListeners) listener(guest.battleId);
  }
  if (recording.status === 'recording' || recording.upload?.state !== 'queued') return;
  await upload(recording, guest.battleId, guest.code);
}

function baseType(mimeType: string): 'video/mp4' | 'video/webm' {
  return mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4';
}

/** Sends the video; with `guestCode` through the friend endpoints (no login). */
async function upload(recording: StoredRecording, battleId: string, guestCode?: string) {
  const settings = recording.upload;
  if (!settings) return;
  const original = await loadRecordingBytes(recording.id);
  if (original.length === 0) throw new ApiError(400, 'recording_empty');

  // Cut without re-encoding; this also makes the file seekable. If the phone cannot cut this
  // file, the whole recording is uploaded with the cut points (cut on the server later).
  let bytes = original;
  let contentType = baseType(recording.mimeType);
  let durationMs: number | null = recording.durationMs || null;
  let trimStartMs: number | null = null;
  let trimEndMs: number | null = null;
  try {
    const cut = trimVideo(original, settings.trimStart ?? 0, settings.trimEnd ?? Infinity);
    bytes = cut.bytes;
    contentType = baseType(cut.mimeType);
    durationMs = Math.round((cut.end - cut.start) * 1000);
  } catch {
    if (settings.trimStart !== undefined) trimStartMs = Math.round(settings.trimStart * 1000);
    if (settings.trimEnd !== undefined) trimEndMs = Math.round(settings.trimEnd * 1000);
  }
  if (bytes.length > MAX_VIDEO_BYTES) throw new ApiError(413, 'video_too_large');

  const announce = {
    attemptId: recording.id,
    contentType,
    sizeBytes: bytes.length,
    durationMs,
    trimStartMs,
    trimEndMs,
    quality: (['saver', 'normal', 'hd'] as const).find((q) => q === recording.quality) ?? 'normal',
    visibility: settings.visibility,
    retention: settings.keep ? 'keep' : 'delete_after_battle',
    endReason: recording.endReason ?? 'stopped',
  } as const;
  const { video, upload: target } = guestCode
    ? await api.guestVideo({ ...announce, code: guestCode })
    : await api.createVideo(announce);
  setProgress(recording.id, 0);
  await send(target, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }), (p) =>
    setProgress(recording.id, p),
  );
  if (guestCode) await api.guestCompleteVideo(video.id, guestCode);
  else await api.completeVideo(video.id);
  setProgress(recording.id, undefined);

  if (settings.askExtraAttempt && !guestCode) {
    try {
      await api.battleAction(battleId, 'proposals', {
        kind: 'extra_attempt',
        change: 1,
        videoId: video.id,
      });
    } catch {
      // The battle may have moved on; the video is uploaded either way.
    }
  }
  // The server has the video now; the copy on the phone is no longer needed.
  await deleteRecording(recording.id);
  for (const listener of serverListeners) listener(battleId);
}

/** PUT with progress (fetch cannot report upload progress). */
function send(
  target: { url: string; method: string; headers: Record<string, string> },
  body: Blob,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status < 300
        ? resolve()
        : // The signed URL may have expired: a server error, so the next run asks for a new one.
          reject(
            new ApiError(
              xhr.status >= 500 || xhr.status === 403 ? 503 : xhr.status,
              'upload_failed',
            ),
          );
    xhr.onerror = () => reject(new ApiError(0, 'offline'));
    xhr.send(body);
  });
}
