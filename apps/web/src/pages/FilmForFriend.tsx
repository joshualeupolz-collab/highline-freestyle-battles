/**
 * Filming for a friend with their athlete code (concept section 6). No account needed, but the
 * app must have been opened online once (it then works offline).
 *
 * Online: enter the code, pick one of the athlete's running battles and a part, record.
 * Offline: enter the code and a short description (opponent, format …), record; the video goes
 * to the athlete's inbox. Once online, this phone offers the battles that were running at the
 * recording time, so the right one can be chosen here (or later by the athlete).
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, api, type GuestBattle } from '../api';
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
/** Attempts recorded offline on this phone, to assign them once online (see the file comment). */
const UNASSIGNED_KEY = 'hfb-guest-unassigned';

interface Unassigned {
  id: string;
  code: string;
  athleteName: string;
  description: string;
  recordedAt: number;
}

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
  const [offline, setOffline] = useState(false);
  const [description, setDescription] = useState('');
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
      setOffline(false);
    } catch (e) {
      setAthlete(null);
      // No connection at the line: record anyway and describe the battle.
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      else setError(e);
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
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7M2-QX9P"
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
        </label>
        <label>
          {t('film.yourName')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <button type="submit" disabled={busy || code.trim().length < 8}>
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
          <p className="muted">
            <button type="button" className="link" onClick={() => setOffline(true)}>
              {t('film.notListed')}
            </button>
          </p>
        </section>
      )}

      {offline && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{t('film.offlineTitle')}</h2>
          <p className="hint">{t('film.offlineHint')}</p>
          <label>
            {t('film.description')}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={t('film.descriptionPlaceholder')}
            />
          </label>
          <button
            type="button"
            disabled={!description.trim() || code.trim().length < 8 || !isRecordingSupported()}
            onClick={() =>
              setTarget({
                ...base,
                battleId: null,
                partIndex: 0,
                description: description.trim(),
                attemptsLeft: null,
              })
            }
          >
            {t('videos.record')}
          </button>
        </section>
      )}

      <GuestRecordings recordings={recordings} onPrepare={setPrepareId} />
      <UnassignedList />

      {target && (
        <RecordScreen
          battleId={target.battleId ?? ''}
          partIndex={target.partIndex}
          guest={{
            code: target.code,
            athleteName: target.athleteName,
            battleId: target.battleId,
            partIndex: target.partIndex,
            round: target.round,
            recorderName: target.recorderName,
            description: target.description,
          }}
          quality={quality}
          onQuality={(q) => {
            setQuality(q);
            write(QUALITY_KEY, q);
          }}
          attemptsLeft={target.attemptsLeft}
          onDone={(recordingId) => {
            if (recordingId && target.battleId === null)
              write(UNASSIGNED_KEY, [
                ...read<Unassigned[]>(UNASSIGNED_KEY, []),
                {
                  id: recordingId,
                  code: target.code,
                  athleteName: target.athleteName,
                  description: target.description ?? '',
                  recordedAt: Date.now(),
                },
              ]);
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
              {r.guest?.description && <div>“{r.guest.description}”</div>}
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

/**
 * Videos recorded offline: once online, show the battles that were running at the recording
 * time and let the friend pick the right one (the opponent confirms it).
 */
function UnassignedList() {
  const [items, setItems] = useState<Unassigned[]>(() => read(UNASSIGNED_KEY, []));
  const [options, setOptions] = useState<Record<string, GuestBattle[]>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(
    () =>
      onRecordingsChanged(() => {
        setItems(read(UNASSIGNED_KEY, []));
      }),
    [],
  );
  const forget = (id: string) => {
    const rest = read<Unassigned[]>(UNASSIGNED_KEY, []).filter((i) => i.id !== id);
    write(UNASSIGNED_KEY, rest);
    setItems(rest);
  };
  if (items.length === 0) return null;

  const load = async (item: Unassigned) => {
    setError(null);
    try {
      const res = await api.guestLookup(item.code, item.recordedAt);
      setOptions((o) => ({ ...o, [item.id]: res.battles }));
    } catch (e) {
      setError(e);
    }
  };
  const assign = async (item: Unassigned, battleId: string, partIndex: number) => {
    setError(null);
    try {
      await api.guestAssign(item.id, item.code, battleId, partIndex);
      forget(item.id);
    } catch (e) {
      // Assigned by the athlete in the meantime: nothing left to do here.
      if (e instanceof ApiError && e.code === 'already_assigned') forget(item.id);
      else setError(e);
    }
  };

  return (
    <section>
      <h2>{t('film.assignTitle')}</h2>
      <p className="hint">{t('film.assignHint')}</p>
      <ErrorText error={error} />
      {items.map((item) => (
        <div key={item.id} className="card">
          <strong>{item.athleteName || item.code}</strong>{' '}
          <span className="muted">{formatDate(item.recordedAt)}</span>
          <div>“{item.description}”</div>
          {options[item.id] === undefined ? (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => load(item)}>
                {t('film.findBattle')}
              </button>
              <button type="button" className="link" onClick={() => forget(item.id)}>
                {t('film.leaveToAthlete')}
              </button>
            </div>
          ) : (options[item.id] ?? []).length === 0 ? (
            <p className="muted">{t('film.noBattlesThen')}</p>
          ) : (
            (options[item.id] ?? []).map((b) =>
              b.parts.map((part, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format never change
                <div key={`${b.id}:${i}`} className="actions">
                  <button type="button" onClick={() => assign(item, b.id, i)}>
                    {b.formatName}
                    {b.parts.length > 1 && ` (${partText(part)})`} ·{' '}
                    {t('film.against', { names: b.opponents.join(', ') })}
                  </button>
                </div>
              )),
            )
          )}
        </div>
      ))}
    </section>
  );
}
