/**
 * In-app recording with MediaRecorder. Every chunk goes straight to IndexedDB (see storage.ts).
 *
 * Findings so far (Chromium, see docs/video-prototype.md): without a short keyframe interval
 * Chrome writes a single keyframe at the start, and its MP4 output only emits data at keyframes.
 * So we ask for a keyframe every second: it makes cutting precise and crash recovery useful.
 */
import type { QualityPreset } from './quality';
import {
  addChunk,
  type BattleAttempt,
  type EndReason,
  type GuestAttempt,
  type StoredRecording,
  saveRecording,
  updateRecording,
} from './storage';

/** Preferred first: H.264 in MP4 plays everywhere (iPhone, Android, desktop, ffmpeg). */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function supportedMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  return MIME_CANDIDATES.filter((type) => MediaRecorder.isTypeSupported(type));
}

export type Facing = 'environment' | 'user';

export interface CameraResult {
  stream: MediaStream;
  /** Set when the microphone could not be used and the camera runs without sound. */
  audioError?: string;
}

export async function openCamera(preset: QualityPreset, facing: Facing): Promise<CameraResult> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facing },
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate },
  };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: true }) };
  } catch (error) {
    // Without microphone permission we still want to test the video part.
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    return { stream, audioError: String(error) };
  }
}

export interface RecordOptions {
  /** undefined = let the browser choose. */
  mimeType: string | undefined;
  quality: string;
  preset: QualityPreset;
  /** undefined = browser default. */
  keyFrameIntervalMs: number | undefined;
  timesliceMs: number;
  attempt: number;
  /** For a battle: the attempt (its id becomes the recording id) and where it belongs. */
  battle?: { attemptId: string } & Omit<BattleAttempt, 'synced'>;
  /** Filming for a friend: the attempt (its id becomes the recording id) and whose it is. */
  guest?: { attemptId: string } & Omit<GuestAttempt, 'synced'>;
}

export interface RecordProgress {
  chunks: number;
  bytes: number;
}

export interface ActiveRecording {
  id: string;
  /** Stops, waits until every chunk is stored and returns the final record. Safe to call twice. */
  stop(reason?: EndReason): Promise<StoredRecording>;
  /** Notes something that happened during the recording (e.g. the app went to the background). */
  note(event: string): void;
}

/**
 * Starts recording. The recording ends by itself when the app goes to the background or the
 * camera stops delivering pictures; `onAutoStop` then receives the final record.
 */
export async function startRecording(
  stream: MediaStream,
  options: RecordOptions,
  onProgress: (p: RecordProgress) => void,
  onAutoStop: (recording: StoredRecording) => void,
): Promise<ActiveRecording> {
  const recorderOptions: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
    videoBitsPerSecond: options.preset.videoBitsPerSecond,
    audioBitsPerSecond: options.preset.audioBitsPerSecond,
  };
  if (options.mimeType) recorderOptions.mimeType = options.mimeType;
  // Chrome 113+; other browsers ignore unknown options.
  if (options.keyFrameIntervalMs)
    recorderOptions.videoKeyFrameIntervalDuration = options.keyFrameIntervalMs;
  const recorder = new MediaRecorder(stream, recorderOptions);

  const id = options.battle?.attemptId ?? options.guest?.attemptId ?? crypto.randomUUID();
  const t0 = performance.now();
  const chunkTimes: number[] = [];
  const events: string[] = [];
  const at = () => `${Math.round(performance.now() - t0)} ms`;
  const recording: StoredRecording = {
    id,
    createdAt: Date.now(),
    status: 'recording',
    attempt: options.attempt,
    quality: options.quality,
    mimeType: options.mimeType ?? '',
    chunkCount: 0,
    bytes: 0,
    durationMs: 0,
    diagnostics: {},
    ...(options.battle && {
      battle: {
        battleId: options.battle.battleId,
        partIndex: options.battle.partIndex,
        round: options.battle.round,
        synced: false,
      },
      upload: { state: 'waiting', visibility: 'public', keep: false },
    }),
    ...(options.guest && {
      guest: (({ attemptId: _, ...g }) => ({ ...g, synced: false }))(options.guest),
      // Someone else's video: only for the review unless the athlete changes it.
      upload: { state: 'waiting', visibility: 'review_only', keep: false },
    }),
  };
  const diagnostics = () => {
    const gaps = chunkTimes.slice(1).map((time, i) => time - (chunkTimes[i] as number));
    return {
      requested: {
        mimeType: options.mimeType ?? '(browser default)',
        ...options.preset,
        keyFrameIntervalMs: options.keyFrameIntervalMs ?? '(browser default)',
        timesliceMs: options.timesliceMs,
      },
      recorderMimeType: recorder.mimeType,
      videoSettings: stream.getVideoTracks()[0]?.getSettings(),
      audioSettings: stream.getAudioTracks()[0]?.getSettings() ?? '(no audio)',
      chunks: {
        count: chunkTimes.length,
        firstAfterMs: chunkTimes[0] !== undefined ? Math.round(chunkTimes[0]) : null,
        maxGapMs: gaps.length ? Math.round(Math.max(...gaps)) : null,
      },
      events,
    };
  };
  await saveRecording(recording);
  // Later saves only touch the recorder's own fields: the upload queue may change the rest
  // (e.g. mark the attempt as synced) while the recording runs.
  const persist = () =>
    updateRecording(id, (current) => ({
      ...current,
      status: recording.status,
      endReason: recording.endReason,
      mimeType: recording.mimeType,
      chunkCount: recording.chunkCount,
      bytes: recording.bytes,
      durationMs: recording.durationMs,
      diagnostics: recording.diagnostics,
    }));

  let index = 0;
  let writes = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    const i = index++;
    chunkTimes.push(performance.now() - t0);
    recording.chunkCount = index;
    recording.bytes += e.data.size;
    recording.mimeType = recorder.mimeType || recording.mimeType || e.data.type;
    onProgress({ chunks: recording.chunkCount, bytes: recording.bytes });
    const data = e.data;
    // Keep the order of writes; the record is saved after each chunk so a crash keeps the counts.
    writes = writes
      .then(async () => {
        await addChunk(id, i, await data.arrayBuffer());
        recording.diagnostics = diagnostics();
        await persist();
      })
      .catch((error) => {
        events.push(`${at()}: storing chunk ${i} failed: ${String(error)}`);
      });
  };
  recorder.onerror = (e) => {
    events.push(`${at()}: recorder error: ${String((e as ErrorEvent).error ?? e.type)}`);
  };
  recorder.start(options.timesliceMs);
  recording.mimeType = recorder.mimeType || recording.mimeType;

  let stopping: Promise<StoredRecording> | undefined;
  const stop = (reason: EndReason = 'stopped') => {
    stopping ??= new Promise((resolve) => {
      cleanup();
      events.push(`${at()}: stopped (${reason})`);
      recorder.onstop = async () => {
        await writes;
        recording.status = 'done';
        recording.endReason = reason;
        recording.durationMs = Math.round(performance.now() - t0);
        recording.diagnostics = diagnostics();
        resolve((await persist()) ?? recording);
      };
      if (recorder.state === 'inactive') recorder.onstop(new Event('stop'));
      else recorder.stop();
    });
    return stopping;
  };
  const autoStop = (reason: EndReason) => {
    if (!stopping) stop(reason).then(onAutoStop);
  };

  // Leaving the app ends the attempt; so does a camera that stops delivering pictures.
  const onVisibility = () => {
    events.push(`${at()}: page ${document.visibilityState}`);
    if (document.visibilityState === 'hidden') autoStop('app_left');
  };
  const onPageHide = () => autoStop('app_left');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  for (const track of stream.getTracks()) {
    track.onended = () => {
      events.push(`${at()}: ${track.kind} track ended`);
      if (track.kind === 'video') autoStop('camera_lost');
    };
    track.onmute = () => {
      events.push(`${at()}: ${track.kind} track muted`);
      if (track.kind === 'video') autoStop('camera_lost');
    };
    track.onunmute = () => events.push(`${at()}: ${track.kind} track unmuted`);
  }
  function cleanup() {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
    }
  }

  return {
    id,
    note: (event) => events.push(`${at()}: ${event}`),
    stop,
  };
}
