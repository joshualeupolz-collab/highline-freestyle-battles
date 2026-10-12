/**
 * Recording, upload and choosing the attempt that counts, on the battle page (concept sections
 * 5.3–5.4 and 6). Recordings live in IndexedDB until the upload queue has sent them.
 */
import { attemptsLeft, newId, slotKey, type VideoVisibility } from '@hfb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Battle, type Format, type BattleVideos as Videos, videoFileUrl } from '../api';
import { partText } from '../battleHelpers';
import { errorText, formatDate, t } from '../i18n';
import { QUALITIES, QUALITY_PRESETS, type Quality } from '../video/quality';
import {
  type ActiveRecording,
  isRecordingSupported,
  openCamera,
  startRecording,
  supportedMimeTypes,
} from '../video/recorder';
import {
  deleteRecording,
  type GuestAttempt,
  listRecordings,
  loadRecordingBytes,
  onRecordingsChanged,
  requestPersistentStorage,
  type StoredRecording,
  updateRecording,
} from '../video/storage';
import { trimVideo } from '../video/trim';
import { kickUploads, onProgress, onServerChanged, uploadProgress } from '../video/uploadQueue';
import { useCameraZoom } from '../video/zoom';
import { ErrorText } from './ErrorText';
import { ReportButton } from './ReportButton';

const ROUND = 1; // multi-round formats come in stage 3
const QUALITY_KEY = 'hfb-quality';

function readQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return QUALITIES.find((x) => x === q) ?? 'normal';
  } catch {
    return 'normal';
  }
}

/** This battle's recordings on this phone, kept up to date. */
function useLocalRecordings(battleId: string) {
  const [recordings, setRecordings] = useState<StoredRecording[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listRecordings()
        .then((all) => alive && setRecordings(all.filter((r) => r.battle?.battleId === battleId)))
        .catch(() => {});
    load();
    const offChanged = onRecordingsChanged(load);
    const offProgress = onProgress(() => setTick((n) => n + 1));
    return () => {
      alive = false;
      offChanged();
      offProgress();
    };
  }, [battleId]);
  return recordings;
}

interface AttemptRow {
  id: string;
  startedAt: number;
  local?: StoredRecording;
  server?: Videos['mine'][number];
}

export function BattleVideos({
  battle,
  format,
  myId,
}: {
  battle: Battle;
  format: Format;
  myId: string;
}) {
  const queryClient = useQueryClient();
  const local = useLocalRecordings(battle.id);
  const [recordPart, setRecordPart] = useState<number | null>(null);
  const [prepareId, setPrepareId] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [error, setError] = useState<unknown>(null);

  // Refresh the battle when the queue registered an attempt or finished an upload.
  useEffect(
    () =>
      onServerChanged((battleId) => {
        if (battleId === battle.id)
          void queryClient.invalidateQueries({ queryKey: ['battle', battle.id] });
      }),
    [battle.id, queryClient],
  );
  useEffect(kickUploads, []);

  const me = battle.participants.find((p) => p.userId === myId);
  const active = battle.status === 'active' && !battle.deadlinePassed;

  // Attempts per part: the server's list plus recordings not yet known there.
  const rows = (partIndex: number): AttemptRow[] => {
    const byId = new Map<string, AttemptRow>();
    for (const a of battle.videos.mine.filter((a) => a.partIndex === partIndex))
      byId.set(a.id, { id: a.id, startedAt: a.startedAt, server: a });
    for (const r of local.filter((r) => r.battle?.partIndex === partIndex)) {
      const row = byId.get(r.id) ?? { id: r.id, startedAt: r.createdAt };
      byId.set(r.id, { ...row, local: r });
    }
    return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
  };
  const used = new Map<string, number>();
  for (let i = 0; i < format.parts.length; i++) used.set(slotKey(i, ROUND), rows(i).length);
  const left = (i: number) =>
    attemptsLeft(battle.settings.attemptsPerVideo, me?.extraAttempts ?? 0, used, slotKey(i, ROUND));

  const choose = async (videoId: string) => {
    setError(null);
    try {
      const res = await api.battleAction(battle.id, 'submissions', { videoId });
      queryClient.setQueryData(['battle', battle.id], res);
    } catch (e) {
      setError(e);
    }
  };

  const prepare = local.find((r) => r.id === prepareId);

  return (
    <section>
      <h2>{t('videos.title')}</h2>
      {active && (
        <details className="hint">
          <summary>{t('battle.howItWorks')}</summary>
          {t('videos.intro')}
        </details>
      )}
      {!isRecordingSupported() && <p className="error">{t('lab.unsupported')}</p>}
      <ErrorText error={error} />
      {format.parts.map((part, i) => {
        const partRows = rows(i);
        const n = left(i);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format version never change
          <div key={i} className="card">
            {format.parts.length > 1 && (
              <h3 style={{ marginTop: 0 }}>
                {t('videos.part', { n: i + 1 })}: {partText(part)}
              </h3>
            )}
            {partRows.length === 0 && <p className="muted">{t('videos.noAttempts')}</p>}
            {partRows.map((row, k) => (
              <AttemptLine
                key={row.id}
                row={row}
                number={k + 1}
                canChoose={battle.status === 'active'}
                onPrepare={() => setPrepareId(row.id)}
                onChoose={choose}
              />
            ))}
            {active && (
              <div className="actions">
                <button
                  type="button"
                  disabled={(n !== null && n <= 0) || !isRecordingSupported()}
                  onClick={() => setRecordPart(i)}
                >
                  {t('videos.record')}
                </button>
                <span className="muted">
                  {n === null ? t('videos.unlimited') : t('videos.left', { n })}
                </span>
              </div>
            )}
          </div>
        );
      })}

      <FilmedByFriends battle={battle} />
      {recordPart !== null && (
        <RecordScreen
          battleId={battle.id}
          partIndex={recordPart}
          quality={quality}
          onQuality={(q) => {
            setQuality(q);
            try {
              localStorage.setItem(QUALITY_KEY, q);
            } catch {
              // Not remembered in private mode.
            }
          }}
          attemptsLeft={left(recordPart)}
          onDone={(recordingId) => {
            setRecordPart(null);
            if (recordingId) setPrepareId(recordingId);
          }}
        />
      )}
      {prepare && (
        <PrepareUpload
          key={prepare.id}
          recording={prepare}
          opponentName={
            battle.participants.find((p) => p.userId !== myId)?.displayName ?? t('videos.opponent')
          }
          onClose={() => setPrepareId(null)}
        />
      )}
    </section>
  );
}

function AttemptLine({
  row,
  number,
  canChoose,
  onPrepare,
  onChoose,
}: {
  row: AttemptRow;
  number: number;
  canChoose: boolean;
  onPrepare: () => void;
  onChoose: (videoId: string) => void;
}) {
  const friend = row.server?.friend ?? null;
  const [watch, setWatch] = useState(false);
  const video = row.server?.video;
  const uploaded = video && (video.status === 'uploaded' || video.status === 'ready');
  const local = row.local;
  const progress = local ? uploadProgress(local.id) : undefined;
  const cutOff = (local?.endReason ?? video?.endReason ?? 'stopped') !== 'stopped';

  let state: string;
  if (uploaded) state = video.counts ? t('videos.counts') : t('videos.uploaded');
  else if (progress !== undefined) state = t('videos.uploading', { p: Math.round(progress * 100) });
  else if (local?.status === 'recording') state = t('videos.recording');
  else if (local?.upload?.state === 'queued') state = t('videos.queued');
  else if (local?.upload?.state === 'failed')
    state = t('videos.failed', { error: errorText(local.upload.error ?? 'unknown_error') });
  else if (local) state = t('videos.notUploaded');
  else state = t('videos.elsewhere');

  return (
    <div className={`attempt${video?.counts ? ' counts' : ''}`}>
      <div>
        <strong>{t('videos.attempt', { n: number })}</strong>{' '}
        <span className="muted">
          {formatDate(row.startedAt)}
          {cutOff && ` · ${t('videos.cutOff')}`}
          {friend &&
            ` · ${friend.name ? t('film.filmedBy', { name: friend.name }) : t('film.filmedByFriend')}`}
        </span>
        <div>{state}</div>
      </div>
      <div className="actions">
        {local && local.status !== 'recording' && local.upload?.state !== 'queued' && (
          <button type="button" className="secondary" onClick={onPrepare}>
            {local.upload?.state === 'failed' ? t('videos.retry') : t('videos.prepare')}
          </button>
        )}
        {uploaded && (
          <button type="button" className="secondary" onClick={() => setWatch(!watch)}>
            {watch ? t('videos.hide') : t('videos.watch')}
          </button>
        )}
        {uploaded && canChoose && !video.counts && (
          <button type="button" onClick={() => onChoose(video.id)}>
            {t('videos.choose')}
          </button>
        )}
      </div>
      {watch && video && <VideoPlayer id={video.id} />}
      {friend && uploaded && <VideoSettings video={video} />}
    </div>
  );
}

/**
 * A friend filmed it, so the friend could not choose who may watch it: the athlete does it here
 * (default: for the review only, deleted after the battle).
 */
export function VideoSettings({
  video,
}: {
  video: { id: string; visibility: string; retention: string };
}) {
  const [visibility, setVisibility] = useState(video.visibility);
  const [keep, setKeep] = useState(video.retention === 'keep');
  const [error, setError] = useState<unknown>(null);
  const save = async (v: string, k: boolean) => {
    setVisibility(v);
    setKeep(k);
    setError(null);
    try {
      await api.videoSettings(video.id, {
        visibility: v,
        retention: k ? 'keep' : 'delete_after_battle',
      });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="inline">
      <select
        aria-label={t('videos.visibility')}
        value={visibility}
        onChange={(e) => save(e.target.value, keep)}
      >
        <option value="public">{t('videos.visibility.public')}</option>
        <option value="logged_in">{t('videos.visibility.logged_in')}</option>
        <option value="review_only">{t('videos.visibility.review_only')}</option>
      </select>
      <label className="check">
        <input
          type="checkbox"
          checked={keep}
          onChange={(e) => save(visibility, e.target.checked)}
        />
        {t('videos.keep')}
      </label>
      <ErrorText error={error} />
    </div>
  );
}

/** Attempts friends filmed for the other side (concept section 6): who filmed and when. */
function FilmedByFriends({ battle }: { battle: Battle }) {
  const items = battle.videos.byFriends ?? [];
  if (items.length === 0) return null;
  const nameOf = (id: string) =>
    battle.participants.find((p) => p.userId === id)?.displayName ?? '';
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('film.byFriendsTitle')}</h3>
      {items.map((a) => (
        <div key={a.id} className="attempt">
          <div>
            <strong>{nameOf(a.userId)}</strong>{' '}
            <span className="muted">
              {formatDate(a.startedAt)} ·{' '}
              {a.friend.name
                ? t('film.filmedBy', { name: a.friend.name })
                : t('film.filmedByFriend')}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VideoPlayer({ id }: { id: string }) {
  return (
    // biome-ignore lint/a11y/useMediaCaption: athletes' videos have no captions
    <video className="lab-video" src={videoFileUrl(id)} controls playsInline preload="metadata" />
  );
}

/**
 * Full-screen camera for one attempt. Pressing the record button uses up the attempt. With
 * `guest`, the attempt is filmed for a friend with their athlete code (pages/FilmForFriend.tsx).
 */
export function RecordScreen({
  battleId,
  partIndex,
  guest,
  quality,
  onQuality,
  attemptsLeft: left,
  onDone,
}: {
  battleId: string;
  partIndex: number;
  guest?: Omit<GuestAttempt, 'synced'>;
  quality: Quality;
  onQuality: (q: Quality) => void;
  attemptsLeft: number | null;
  onDone: (recordingId: string | null) => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const zoom = useCameraZoom(stream);
  const finished = useRef(false);

  const finish = useCallback(
    (recordingId: string | null) => {
      if (finished.current) return;
      finished.current = true;
      onDone(recordingId);
    },
    [onDone],
  );

  useEffect(() => {
    let current: MediaStream | null = null;
    openCamera(QUALITY_PRESETS[quality], 'environment')
      .then((result) => {
        current = result.stream;
        setStream(result.stream);
      })
      .catch((e) => setError(t('lab.cameraError', { error: String(e) })));
    return () => {
      for (const track of current?.getTracks() ?? []) track.stop();
    };
  }, [quality]);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream;
  }, [stream]);

  // Timer, screen wake lock and a warning before closing the page while recording.
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    let lock: { release(): Promise<void> } | undefined;
    navigator.wakeLock
      ?.request('screen')
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(timer);
      lock?.release().catch(() => {});
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);

  async function start() {
    if (!stream) return;
    setError(null);
    try {
      await requestPersistentStorage();
      const recording = await startRecording(
        stream,
        {
          mimeType: supportedMimeTypes()[0],
          quality,
          preset: QUALITY_PRESETS[quality],
          keyFrameIntervalMs: 1000,
          timesliceMs: 1000,
          attempt: 0,
          ...(guest
            ? { guest: { attemptId: newId(), ...guest } }
            : { battle: { attemptId: newId(), battleId, partIndex, round: ROUND } }),
        },
        () => {},
        // Leaving the app ended the attempt.
        (stopped) => finish(stopped.id),
      );
      setActive(recording);
      kickUploads(); // registers the attempt right away if there is a connection
    } catch (e) {
      setError(t('lab.recordError', { error: String(e) }));
    }
  }

  async function stop() {
    if (!active) return;
    const recording = await active.stop();
    finish(recording.id);
  }

  return (
    // touch-action: none keeps two fingers from zooming the page; they zoom the camera instead.
    <div className="camera-full" {...zoom.handlers}>
      <video ref={preview} autoPlay muted playsInline />
      <div className="camera-top">
        {!active && (
          <fieldset className="segmented" aria-label={t('lab.quality')}>
            {QUALITIES.map((q) => (
              <button
                key={q}
                type="button"
                className={q === quality ? 'on' : ''}
                onClick={() => onQuality(q)}
              >
                {QUALITY_PRESETS[q].height}p
              </button>
            ))}
            <button
              type="button"
              className="info"
              aria-label={t('camera.qualityInfo')}
              onClick={() => setShowInfo(!showInfo)}
            >
              i
            </button>
          </fieldset>
        )}
        {zoom.available && <span className="zoom-label">{zoom.value.toFixed(1)}×</span>}
      </div>
      {showInfo && !active && (
        <div className="camera-info">
          <p>{t('camera.quality.hd')}</p>
          <p>{t('camera.quality.normal')}</p>
          <p>{t('camera.quality.saver')}</p>
          <p>{zoom.available ? t('camera.zoomHint') : t('camera.noZoom')}</p>
        </div>
      )}
      <div className="camera-controls">
        <button
          type="button"
          className="camera-close"
          disabled={!!active}
          aria-label={t('lab.cameraOff')}
          onClick={() => finish(null)}
        >
          ✕
        </button>
        <button
          type="button"
          className={`record-button${active ? ' recording' : ''}`}
          disabled={!stream || (!active && left !== null && left <= 0)}
          aria-label={active ? t('lab.stop') : t('videos.record')}
          onClick={active ? stop : start}
        />
        <div className="camera-status">
          {active ? (
            <strong>● {elapsed.toFixed(1)} s</strong>
          ) : (
            <span>{left === null ? t('videos.unlimited') : t('videos.left', { n: left })}</span>
          )}
          {error && <span className="error">{error}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Watch the recording, mark the cut and the visibility, then hand it to the upload queue.
 * Filmed for a friend, the athlete decides about visibility and keeping later.
 */
export function PrepareUpload({
  recording,
  opponentName,
  onClose,
}: {
  recording: StoredRecording;
  opponentName: string;
  onClose: () => void;
}) {
  const forFriend = !!recording.guest;
  const player = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [start, setStart] = useState(recording.upload?.trimStart ?? 0);
  const [end, setEnd] = useState<number | null>(recording.upload?.trimEnd ?? null);
  const [visibility, setVisibility] = useState<VideoVisibility>(
    recording.upload?.visibility ?? 'public',
  );
  const [keep, setKeep] = useState(recording.upload?.keep ?? false);
  const cutOff = (recording.endReason ?? 'stopped') !== 'stopped';
  const [askExtra, setAskExtra] = useState(
    recording.upload?.askExtraAttempt ?? (cutOff && !forFriend),
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    loadRecordingBytes(recording.id).then((bytes) => {
      if (cancelled) return;
      let data = bytes;
      let type = (recording.mimeType || 'video/mp4').split(';')[0] as string;
      try {
        // Rewriting the whole file makes the preview seekable (see VideoLab).
        const full = trimVideo(bytes, 0, Number.POSITIVE_INFINITY);
        data = full.bytes;
        type = full.mimeType;
        setDuration(full.end - full.start);
      } catch {
        // Unknown layout: play the raw file.
      }
      objectUrl = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recording.id, recording.mimeType]);

  const here = () => Number((player.current?.currentTime ?? 0).toFixed(2));

  async function queue() {
    await updateRecording(recording.id, (r) => ({
      ...r,
      upload: {
        state: 'queued',
        trimStart: start > 0 ? start : undefined,
        trimEnd: end ?? undefined,
        visibility,
        keep,
        askExtraAttempt: cutOff && askExtra,
      },
    }));
    kickUploads();
    onClose();
  }

  const failed = recording.upload?.state === 'failed';
  const refused = failed && recording.upload?.error !== 'video_too_large';

  return (
    <div className="card notice">
      <h3 style={{ marginTop: 0 }}>{t('videos.prepareTitle')}</h3>
      {cutOff && <p>{t('videos.cutOffHint')}</p>}
      {url ? (
        // biome-ignore lint/a11y/useMediaCaption: athletes' videos have no captions
        <video ref={player} className="lab-video" src={url} controls playsInline />
      ) : (
        <p className="muted">{t('common.loading')}</p>
      )}
      <p className="hint">{t('videos.cutHint')}</p>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => setStart(here())}>
          {t('lab.setStart')}
        </button>
        <button type="button" className="secondary" onClick={() => setEnd(here())}>
          {t('lab.setEnd')}
        </button>
        <span className="muted">
          {t('videos.cutRange', {
            start: start.toFixed(1),
            end: (end ?? duration ?? 0).toFixed(1),
          })}
        </span>
        {(start > 0 || end !== null) && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setStart(0);
              setEnd(null);
            }}
          >
            {t('videos.noCut')}
          </button>
        )}
      </div>
      {forFriend ? (
        <p className="hint">{t('film.visibilityHint')}</p>
      ) : (
        <>
          <label>
            {t('videos.visibility')}
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as VideoVisibility)}
            >
              <option value="public">{t('videos.visibility.public')}</option>
              <option value="logged_in">{t('videos.visibility.logged_in')}</option>
              <option value="review_only">{t('videos.visibility.review_only')}</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            {t('videos.keep')}
          </label>
        </>
      )}
      {cutOff && !forFriend && (
        <label className="check">
          <input
            type="checkbox"
            checked={askExtra}
            onChange={(e) => setAskExtra(e.target.checked)}
          />
          {t('videos.askExtra', { name: opponentName })}
        </label>
      )}
      <div className="actions">
        <button type="button" disabled={end !== null && end <= start} onClick={queue}>
          {t('videos.upload')}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('videos.later')}
        </button>
        {refused && (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await deleteRecording(recording.id);
              onClose();
            }}
          >
            {t('videos.delete')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The videos that count, once everyone has chosen (concept 5.4). */
export function UnlockedVideos({ battle, format }: { battle: Battle; format: Format }) {
  if (!battle.videos.unlocked) return null;
  return (
    <section>
      <h2>{t('videos.unlockedTitle')}</h2>
      {format.parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format version never change
        <div key={i} className="card">
          {format.parts.length > 1 && (
            <h3 style={{ marginTop: 0 }}>
              {t('videos.part', { n: i + 1 })}: {partText(part)}
            </h3>
          )}
          {battle.participants.map((p) => {
            const slot = battle.videos.slots.find(
              (s) => s.userId === p.userId && s.partIndex === i,
            );
            return (
              <div key={p.userId}>
                <strong>{p.displayName}</strong>
                {slot?.videoId ? (
                  <>
                    <VideoPlayer id={slot.videoId} />
                    <ReportButton targetType="video" targetId={slot.videoId} />
                  </>
                ) : (
                  <p className="muted">{t('videos.notVisible')}</p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/** What the opponent has done so far, without revealing their videos. */
export function OpponentProgress({ battle, myId }: { battle: Battle; myId: string }) {
  if (battle.status !== 'active') return null;
  const others = battle.participants.filter((p) => p.userId !== myId);
  return (
    <>
      {others.map((p) => {
        const slots = battle.videos.slots.filter((s) => s.userId === p.userId);
        const attempts = slots.reduce((sum, s) => sum + s.attempts, 0);
        const uploaded = slots.reduce((sum, s) => sum + s.uploaded, 0);
        const chosen = slots.filter((s) => s.submittedAt !== null).length;
        return (
          <p key={p.userId} className="muted" style={{ margin: 0 }}>
            {t('videos.opponentProgress', { name: p.displayName, attempts, uploaded, chosen })}
          </p>
        );
      })}
    </>
  );
}
