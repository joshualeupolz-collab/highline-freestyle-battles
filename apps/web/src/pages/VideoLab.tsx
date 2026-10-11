import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatDate, t } from '../i18n';
import { expectedMbPerMinute, QUALITIES, QUALITY_PRESETS, type Quality } from '../video/quality';
import {
  type ActiveRecording,
  type Facing,
  isRecordingSupported,
  MIME_CANDIDATES,
  openCamera,
  startRecording,
  supportedMimeTypes,
} from '../video/recorder';
import {
  deleteRecording,
  type EndReason,
  listRecordings,
  loadRecordingBytes,
  markInterruptedRecordings,
  requestPersistentStorage,
  type StoredRecording,
  storageInfo,
} from '../video/storage';
import { analyzeVideo, type TrimResult, trimVideo, type VideoInfo } from '../video/trim';

/**
 * Video prototype (development step 7): a test page for real phones, reachable without login at
 * /lab/video. It records in the app, stores every chunk locally, cuts without re-encoding and
 * produces a report testers can send back. Nothing is uploaded. Test guide: docs/video-prototype.md
 */

const ATTEMPTS_KEY = 'hfb-lab-attempts-used';

function readAttemptsUsed(): number {
  try {
    return Number(localStorage.getItem(ATTEMPTS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeAttemptsUsed(n: number): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, String(n));
  } catch {
    // Private mode: the counter is only kept in memory.
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function sec(s: number): string {
  return `${s.toFixed(2)} s`;
}

function environment() {
  const types: Record<string, boolean> = {};
  for (const type of MIME_CANDIDATES) {
    types[type] = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
  }
  return {
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
    installedApp: matchMedia('(display-mode: standalone)').matches,
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    mimeTypes: types,
  };
}

export function VideoLabPage() {
  const supported = isRecordingSupported();
  const [types] = useState(supportedMimeTypes);

  const [quality, setQuality] = useState<Quality>('normal');
  const [mimeType, setMimeType] = useState<string>('auto');
  const [facing, setFacing] = useState<Facing>('environment');
  const [keyFrameMs, setKeyFrameMs] = useState(1000);
  const [attemptsAllowed, setAttemptsAllowed] = useState(3);
  const [attemptsUsed, setAttemptsUsed] = useState(readAttemptsUsed);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [progress, setProgress] = useState({ chunks: 0, bytes: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [autoStopped, setAutoStopped] = useState<EndReason | null>(null);

  const [recordings, setRecordings] = useState<StoredRecording[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(0);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageInfo>>>({});

  const preview = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    setRecordings((await listRecordings()).filter((r) => !r.battle));
    setStorage(await storageInfo());
  }, []);

  useEffect(() => {
    markInterruptedRecordings()
      .then(setInterrupted)
      .then(refresh)
      .catch((e) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream;
    return () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [stream]);

  // Timer, wake lock and a warning before closing the page while recording.
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
      .catch(() => active.note('screen wake lock not available'));
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(timer);
      lock?.release().catch(() => {});
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);

  async function turnOnCamera() {
    setError(null);
    setCameraNote(null);
    setAutoStopped(null);
    try {
      for (const track of stream?.getTracks() ?? []) track.stop();
      const result = await openCamera(QUALITY_PRESETS[quality], facing);
      setStream(result.stream);
      if (result.audioError) setCameraNote(t('lab.noAudio', { error: result.audioError }));
    } catch (e) {
      setError(t('lab.cameraError', { error: String(e) }));
    }
  }

  async function start() {
    if (!stream) return;
    setError(null);
    const attempt = attemptsUsed + 1;
    // Pressing Start uses up the attempt, even if the recording fails.
    setAttemptsUsed(attempt);
    writeAttemptsUsed(attempt);
    try {
      await requestPersistentStorage();
      setProgress({ chunks: 0, bytes: 0 });
      setElapsed(0);
      const recording = await startRecording(
        stream,
        {
          mimeType: mimeType === 'auto' ? types[0] : mimeType || undefined,
          quality,
          preset: QUALITY_PRESETS[quality],
          keyFrameIntervalMs: keyFrameMs || undefined,
          timesliceMs: 1000,
          attempt,
        },
        setProgress,
        async (stopped) => {
          // App left or camera lost: the attempt is over and the camera is released.
          setActive(null);
          setStream(null);
          setAutoStopped(stopped.endReason ?? 'stopped');
          await refresh();
          setSelectedId(stopped.id);
        },
      );
      setActive(recording);
      await refresh();
    } catch (e) {
      setError(t('lab.recordError', { error: String(e) }));
    }
  }

  async function stop() {
    if (!active) return;
    const recording = await active.stop();
    setActive(null);
    setStream(null);
    await refresh();
    setSelectedId(recording.id);
  }

  if (!supported) {
    return (
      <main>
        <h1>{t('lab.title')}</h1>
        <p className="error">{t('lab.unsupported')}</p>
        <Diagnostics env={environment()} storage={storage} />
      </main>
    );
  }

  const preset = QUALITY_PRESETS[quality];
  const attemptsLeft = attemptsAllowed - attemptsUsed;
  const selected = recordings.find((r) => r.id === selectedId);

  return (
    <main>
      <p className="muted">
        <Link to="/">{t('appName')}</Link>
      </p>
      <h1>{t('lab.title')}</h1>
      <p className="hint">{t('lab.intro')}</p>
      {interrupted > 0 && (
        <p className="card notice">{t('lab.recovered', { count: interrupted })}</p>
      )}

      <div className="card">
        <h2>{t('lab.settings')}</h2>
        <label>
          {t('lab.quality')}
          <select
            value={quality}
            disabled={!!active}
            onChange={(e) => setQuality(e.target.value as Quality)}
          >
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {t(`lab.quality.${q}`)} ({QUALITY_PRESETS[q].height}p, ≈
                {expectedMbPerMinute(QUALITY_PRESETS[q]).toFixed(0)} MB/min)
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{t('lab.hdHint')}</p>
        <label>
          {t('lab.camera')}
          <select
            value={facing}
            disabled={!!active}
            onChange={(e) => setFacing(e.target.value as Facing)}
          >
            <option value="environment">{t('lab.camera.back')}</option>
            <option value="user">{t('lab.camera.front')}</option>
          </select>
        </label>
        <label>
          {t('lab.format')}
          <select
            value={mimeType}
            disabled={!!active}
            onChange={(e) => setMimeType(e.target.value)}
          >
            <option value="auto">
              {t('lab.format.auto')} ({types[0] ?? t('lab.format.browser')})
            </option>
            <option value="">{t('lab.format.browser')}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('lab.keyframes')}
          <select
            value={keyFrameMs}
            disabled={!!active}
            onChange={(e) => setKeyFrameMs(Number(e.target.value))}
          >
            <option value={1000}>{t('lab.keyframes.every', { seconds: 1 })}</option>
            <option value={2000}>{t('lab.keyframes.every', { seconds: 2 })}</option>
            <option value={0}>{t('lab.keyframes.default')}</option>
          </select>
        </label>
        <label>
          {t('lab.attempts')}
          <input
            type="number"
            min={1}
            max={99}
            value={attemptsAllowed}
            onChange={(e) => setAttemptsAllowed(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <p className="hint">{t('lab.applyHint')}</p>
      </div>

      <div className="card">
        {autoStopped && autoStopped !== 'stopped' && (
          <p className="card notice">{t(`lab.autoStopped.${autoStopped}`)}</p>
        )}
        <p>
          {t('lab.attemptsLeft', { left: Math.max(0, attemptsLeft), total: attemptsAllowed })}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setAttemptsUsed(0);
              writeAttemptsUsed(0);
            }}
          >
            {t('lab.resetAttempts')}
          </button>
        </p>
        <div className="actions">
          <button type="button" onClick={turnOnCamera}>
            {t('lab.cameraOn')}
          </button>
        </div>
        <p className="hint">{t('lab.startHint', { mb: expectedMbPerMinute(preset).toFixed(0) })}</p>
        <p className="hint">{t('lab.leaveHint')}</p>
        {cameraNote && <p className="hint">{cameraNote}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {stream && (
        <div className="camera-full">
          <video ref={preview} autoPlay muted playsInline />
          <div className="camera-controls">
            <button
              type="button"
              className="camera-close"
              disabled={!!active}
              aria-label={t('lab.cameraOff')}
              onClick={() => setStream(null)}
            >
              ✕
            </button>
            <button
              type="button"
              className={`record-button${active ? ' recording' : ''}`}
              disabled={!active && attemptsLeft <= 0}
              aria-label={active ? t('lab.stop') : t('lab.start', { attempt: attemptsUsed + 1 })}
              onClick={active ? stop : start}
            />
            <div className="camera-status">
              {active ? (
                <>
                  <strong>● {sec(elapsed)}</strong>
                  <span>{mb(progress.bytes)}</span>
                </>
              ) : (
                <span>
                  {t('lab.attemptsLeft', {
                    left: Math.max(0, attemptsLeft),
                    total: attemptsAllowed,
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>{t('lab.recordings')}</h2>
        {recordings.length === 0 && <p className="muted">{t('lab.noRecordings')}</p>}
        {recordings.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`tile lab-item${r.id === selectedId ? ' selected' : ''}`}
            onClick={() => setSelectedId(r.id)}
          >
            <strong>
              {t('lab.attemptNo', { attempt: r.attempt })} · {formatDate(r.createdAt)}
            </strong>
            <span>
              {mb(r.bytes)} · {r.quality} · {r.mimeType || '?'}
              {r.status !== 'done' && ` · ${t(`lab.status.${r.status}`)}`}
              {r.endReason &&
                r.endReason !== 'stopped' &&
                ` · ${t(`lab.endReason.${r.endReason}`)}`}
            </span>
          </button>
        ))}
        {storage.quota !== undefined && (
          <p className="hint">
            {t('lab.storage', {
              used: mb(storage.usage ?? 0),
              quota: mb(storage.quota),
              persisted: storage.persisted ? t('lab.persisted.yes') : t('lab.persisted.no'),
            })}
          </p>
        )}
      </div>

      {selected && (
        <RecordingView
          key={selected.id}
          recording={selected}
          storage={storage}
          onDeleted={async () => {
            setSelectedId(null);
            await refresh();
          }}
        />
      )}

      <Diagnostics env={environment()} storage={storage} />
    </main>
  );
}

interface TrimRun {
  id: number;
  requested: { start: number; end: number };
  result?: TrimResult;
  url?: string;
  ms: number;
  error?: string;
}

function RecordingView(props: {
  recording: StoredRecording;
  storage: Awaited<ReturnType<typeof storageInfo>>;
  onDeleted: () => void;
}) {
  const { recording } = props;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [remuxMs, setRemuxMs] = useState<number | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [runs, setRuns] = useState<TrimRun[]>([]);
  const [copied, setCopied] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const urls = useRef<string[]>([]);

  const makeUrl = useCallback((data: Uint8Array, type: string) => {
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
    urls.current.push(url);
    return url;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecordingBytes(recording.id).then((data) => {
      if (cancelled) return;
      setBytes(data);
      const type = (recording.mimeType || 'video/mp4').split(';')[0] as string;
      const raw = makeUrl(data, type);
      setRawUrl(raw);
      try {
        const analysis = analyzeVideo(data);
        setInfo(analysis);
        setEnd(Number(analysis.duration.toFixed(2)));
        // Rewriting the whole file adds duration and index, so the preview can be seeked.
        const t0 = performance.now();
        const full = trimVideo(data, 0, Number.POSITIVE_INFINITY);
        setRemuxMs(Math.round(performance.now() - t0));
        setPlayUrl(makeUrl(full.bytes, full.mimeType));
      } catch (e) {
        setAnalysisError(String(e));
        setPlayUrl(raw);
      }
    });
    return () => {
      cancelled = true;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [recording.id, recording.mimeType, makeUrl]);

  function cut() {
    if (!bytes) return;
    const t0 = performance.now();
    try {
      const result = trimVideo(bytes, start, end);
      const ms = Math.round(performance.now() - t0);
      setRuns((r) => [
        {
          id: Date.now(),
          requested: { start, end },
          result,
          ms,
          url: makeUrl(result.bytes, result.mimeType),
        },
        ...r,
      ]);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      setRuns((r) => [{ id: Date.now(), requested: { start, end }, ms, error: String(e) }, ...r]);
    }
  }

  const extension = info?.container === 'webm' ? 'webm' : 'mp4';
  const name = `attempt-${recording.attempt}-${new Date(recording.createdAt).toISOString().slice(0, 19)}`;

  const report = JSON.stringify(
    {
      report: 'hfb video lab',
      version: 1,
      createdAt: new Date().toISOString(),
      environment: environment(),
      storage: props.storage,
      recording: {
        ...recording,
        mbPerMinute: recording.durationMs
          ? Number(((recording.bytes / 1_000_000) * (60_000 / recording.durationMs)).toFixed(1))
          : null,
      },
      analysis: info && {
        ...info,
        keyframes: info.keyframes.length,
        keyframeIntervalS: keyframeInterval(info.keyframes),
      },
      analysisError,
      previewRemuxMs: remuxMs,
      cuts: runs.map((r) => ({
        requested: r.requested,
        ms: r.ms,
        error: r.error,
        start: r.result?.start,
        end: r.result?.end,
        bytes: r.result?.bytes.length,
      })),
    },
    null,
    2,
  );

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: t('lab.reportTitle'), text: report });
      else {
        await navigator.clipboard.writeText(report);
        setCopied(true);
      }
    } catch {
      // Share sheet closed or clipboard blocked: the report is still visible below.
    }
  }

  return (
    <div className="card">
      <h2>{t('lab.attemptNo', { attempt: recording.attempt })}</h2>
      {!bytes && <p className="muted">{t('common.loading')}</p>}
      {playUrl && (
        // biome-ignore lint/a11y/useMediaCaption: test recordings have no captions
        <video ref={player} className="lab-video" src={playUrl} controls playsInline />
      )}
      {info && (
        <dl>
          <dt>{t('lab.info.duration')}</dt>
          <dd>{sec(info.duration)}</dd>
          <dt>{t('lab.info.size')}</dt>
          <dd>{mb(recording.bytes)}</dd>
          <dt>{t('lab.info.tracks')}</dt>
          <dd>
            {info.tracks
              .map((tr) => `${tr.kind} ${tr.codec}${tr.width ? ` ${tr.width}x${tr.height}` : ''}`)
              .join(', ')}
          </dd>
          <dt>{t('lab.info.keyframes')}</dt>
          <dd>
            {info.keyframes.length} (
            {t('lab.info.every', { seconds: keyframeInterval(info.keyframes) ?? '–' })})
          </dd>
        </dl>
      )}
      {analysisError && <p className="error">{t('lab.analysisError', { error: analysisError })}</p>}

      {info && (
        <>
          <h2>{t('lab.cut')}</h2>
          <p className="hint">{t('lab.cutHint')}</p>
          <div className="row">
            <label>
              {t('lab.cutStart')}
              <input
                type="number"
                step="0.1"
                min={0}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </label>
            <label>
              {t('lab.cutEnd')}
              <input
                type="number"
                step="0.1"
                min={0}
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setStart(Number((player.current?.currentTime ?? 0).toFixed(2)))}
            >
              {t('lab.setStart')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEnd(Number((player.current?.currentTime ?? 0).toFixed(2)))}
            >
              {t('lab.setEnd')}
            </button>
            <button type="button" onClick={cut} disabled={!(end > start)}>
              {t('lab.cutNow')}
            </button>
          </div>
        </>
      )}

      {runs.map((run) => (
        <div key={run.id} className="card part">
          {run.error ? (
            <p className="error">{t('lab.cutError', { error: run.error })}</p>
          ) : (
            run.result && (
              <>
                <p>
                  {t('lab.cutResult', {
                    start: sec(run.result.start),
                    end: sec(run.result.end),
                    requested: sec(run.requested.start),
                    size: mb(run.result.bytes.length),
                    ms: run.ms,
                  })}
                </p>
                {/* biome-ignore lint/a11y/useMediaCaption: test recordings have no captions */}
                <video className="lab-video" src={run.url} controls playsInline />
                <a href={run.url} download={`${name}-cut.${extension}`}>
                  {t('lab.download')}
                </a>
              </>
            )
          )}
        </div>
      ))}

      <h2>{t('lab.report')}</h2>
      <p className="hint">{t('lab.reportHint')}</p>
      <div className="actions">
        <button type="button" onClick={share}>
          {copied ? t('lab.copied') : t('lab.share')}
        </button>
        {rawUrl && (
          <a className="button secondary" href={rawUrl} download={`${name}-original.${extension}`}>
            {t('lab.downloadOriginal')}
          </a>
        )}
        <button
          type="button"
          className="danger"
          onClick={async () => {
            await deleteRecording(recording.id);
            props.onDeleted();
          }}
        >
          {t('lab.delete')}
        </button>
      </div>
      <details>
        <summary>{t('lab.showReport')}</summary>
        <pre className="lab-report">{report}</pre>
      </details>
    </div>
  );
}

function keyframeInterval(keyframes: number[]): number | null {
  if (keyframes.length < 2) return null;
  const span = (keyframes[keyframes.length - 1] as number) - (keyframes[0] as number);
  return Number((span / (keyframes.length - 1)).toFixed(2));
}

function Diagnostics(props: {
  env: ReturnType<typeof environment>;
  storage: Awaited<ReturnType<typeof storageInfo>>;
}) {
  return (
    <details className="card">
      <summary>{t('lab.device')}</summary>
      <pre className="lab-report">
        {JSON.stringify({ ...props.env, storage: props.storage }, null, 2)}
      </pre>
    </details>
  );
}
