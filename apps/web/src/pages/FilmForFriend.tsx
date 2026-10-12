/**
 * Filming for a friend with their athlete code (concept section 6). No account needed; online
 * only (owner, 2026-10-12): enter the code, pick one of the athlete's running battles and a
 * part, record. The upload waits on the phone if the connection drops after recording.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type GuestBattle } from '../api';
import { partText } from '../battleHelpers';
import { PrepareUpload, RecordScreen } from '../components/BattleVideos';
import { ErrorText } from '../components/ErrorText';
import { errorText, formatDate, t } from '../i18n';
import { QUALITIES, type Quality } from '../video/quality';
import { isRecordingSupported } from '../video/recorder';
import {
  type GuestAttempt,
  listRecordings,
  onRecordingsChanged,
  type StoredRecording,
} from '../video/storage';
import { kickUploads, onProgress, uploadProgress } from '../video/uploadQueue';

const CODE_KEY = 'hfb-guest-code';
const NAME_KEY = 'hfb-guest-name';
const QUALITY_KEY = 'hfb-quality';
function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered in private mode.
  }
}

type Target = Omit<GuestAttempt, 'synced'> & { attemptsLeft: number | null };

export function FilmForFriendPage() {
  // A shared link carries the code (Profile → athlete code → share).
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => params.get('code') ?? read(CODE_KEY, ''));
  const [name, setName] = useState(() => read(NAME_KEY, ''));
  const [athlete, setAthlete] = useState<{ displayName: string; battles: GuestBattle[] } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [prepareId, setPrepareId] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(() => {
    const q = read<string>(QUALITY_KEY, 'normal');
    return QUALITIES.find((x) => x === q) ?? 'normal';
  });
  const recordings = useGuestRecordings();

  async function lookup() {
    setError(null);
    setBusy(true);
    write(CODE_KEY, code);
    write(NAME_KEY, name);
    try {
      const res = await api.guestLookup(code);
      setAthlete({ displayName: res.athlete.displayName, battles: res.battles });
    } catch (e) {
      setAthlete(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const base = {
    code,
    athleteName: athlete?.displayName ?? '',
    round: 1,
    recorderName: name.trim() || undefined,
  };
  const prepare = recordings.find((r) => r.id === prepareId);

  return (
    <main>
      <h1>{t('film.title')}</h1>
      <p className="hint">{t('film.intro')}</p>
      {!isRecordingSupported() && <p className="error">{t('lab.unsupported')}</p>}

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <label>
          {t('film.code')}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            required
          />
        </label>
        <label>
          {t('film.yourName')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <button type="submit" disabled={busy || !code.trim()}>
          {t('film.continue')}
        </button>
        <ErrorText error={error} />
      </form>

      {athlete && (
        <section>
          <h2>{t('film.battlesOf', { name: athlete.displayName })}</h2>
          {athlete.battles.length === 0 && <p className="muted">{t('film.noBattles')}</p>}
          {athlete.battles.map((b) => (
            <div key={b.id} className="card">
              <strong>{b.formatName}</strong>{' '}
              <span className="muted">
                {t('film.against', { names: b.opponents.join(', ') })}
                {b.deadlineAt !== null && ` · ${formatDate(b.deadlineAt)}`}
              </span>
              {b.parts.map((part, i) => {
                const left = b.attemptsLeft[i] ?? null;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format never change
                  <div key={i} className="actions">
                    <button
                      type="button"
                      disabled={(left !== null && left <= 0) || !isRecordingSupported()}
                      onClick={() =>
                        setTarget({ ...base, battleId: b.id, partIndex: i, attemptsLeft: left })
                      }
                    >
                      {b.parts.length > 1
                        ? `${t('videos.record')}: ${partText(part)}`
                        : t('videos.record')}
                    </button>
                    <span className="muted">
                      {left === null ? t('videos.unlimited') : t('videos.left', { n: left })}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}

      <GuestRecordings recordings={recordings} onPrepare={setPrepareId} />

      {target && (
        <RecordScreen
          battleId={target.battleId}
          partIndex={target.partIndex}
          guest={{
            code: target.code,
            athleteName: target.athleteName,
            battleId: target.battleId,
            partIndex: target.partIndex,
            round: target.round,
            recorderName: target.recorderName,
          }}
          quality={quality}
          onQuality={(q) => {
            setQuality(q);
            write(QUALITY_KEY, q);
          }}
          attemptsLeft={target.attemptsLeft}
          onDone={(recordingId) => {
            setTarget(null);
            if (recordingId) setPrepareId(recordingId);
            if (athlete) void lookup(); // attempts left changed
          }}
        />
      )}
      {prepare && (
        <PrepareUpload
          key={prepare.id}
          recording={prepare}
          opponentName=""
          onClose={() => setPrepareId(null)}
        />
      )}
      <p className="muted" style={{ textAlign: 'center' }}>
        <Link to="/">{t('film.toApp')}</Link>
      </p>
    </main>
  );
}

/** Recordings for friends still on this phone (until their upload is done). */
function useGuestRecordings() {
  const [recordings, setRecordings] = useState<StoredRecording[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listRecordings()
        .then((all) => alive && setRecordings(all.filter((r) => r.guest)))
        .catch(() => {});
    load();
    kickUploads();
    const offChanged = onRecordingsChanged(load);
    const offProgress = onProgress(() => setTick((n) => n + 1));
    return () => {
      alive = false;
      offChanged();
      offProgress();
    };
  }, []);
  return recordings;
}

function GuestRecordings({
  recordings,
  onPrepare,
}: {
  recordings: StoredRecording[];
  onPrepare: (id: string) => void;
}) {
  if (recordings.length === 0) return null;
  return (
    <section>
      <h2>{t('film.onThisPhone')}</h2>
      {recordings.map((r) => {
        const progress = uploadProgress(r.id);
        let state: string;
        if (progress !== undefined)
          state = t('videos.uploading', { p: Math.round(progress * 100) });
        else if (r.status === 'recording') state = t('videos.recording');
        else if (r.upload?.state === 'queued') state = t('videos.queued');
        else if (r.upload?.state === 'failed')
          state = t('videos.failed', { error: errorText(r.upload.error ?? 'unknown_error') });
        else state = t('videos.notUploaded');
        return (
          <div key={r.id} className="card attempt">
            <div>
              <strong>{r.guest?.athleteName || r.guest?.code}</strong>{' '}
              <span className="muted">{formatDate(r.createdAt)}</span>
              <div>{state}</div>
            </div>
            {r.status !== 'recording' && r.upload?.state !== 'queued' && (
              <button type="button" className="secondary" onClick={() => onPrepare(r.id)}>
                {r.upload?.state === 'failed' ? t('videos.retry') : t('videos.prepare')}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
