/**
 * Filming for a friend with their athlete code (concept section 6). No account needed: enter the
 * code, pick one of the athlete's running battles and a part, record (owner, 2026-10-12). The
 * upload waits on the phone if the connection drops after recording. Filming offline needs
 * attempts reserved on this phone beforehand ("Prepare for offline filming"); the prepared
 * battles are kept on the phone and shown even without a connection.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type GuestBattle } from '../api';
import { partText } from '../battleHelpers';
import { LeftText, PrepareUpload, RecordScreen } from '../components/BattleVideos';
import { ErrorText } from '../components/ErrorText';
import { ReserveForm, useOnline } from '../components/OfflineReservations';
import { errorText, formatDate, t } from '../i18n';
import {
  addLocalReservations,
  deviceCode,
  type LocalReservation,
  localReservations,
  onReservationsChanged,
  removeLocalReservation,
  reservationFor,
} from '../video/device';
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

type Target = Omit<GuestAttempt, 'synced'> & {
  attemptsLeft: number | null;
  limited: boolean;
};

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
  const [reserveFor, setReserveFor] = useState<string | null>(null);
  const prepared = useGuestReservations();
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
                const reservation = reservationFor(b.id, i, code);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format never change
                  <div key={i} className="actions">
                    <button
                      type="button"
                      disabled={!isRecordingSupported()}
                      onClick={() =>
                        setTarget({
                          ...base,
                          battleId: b.id,
                          partIndex: i,
                          attemptsLeft: left,
                          limited: b.attemptsPerVideo !== null,
                          ...(reservation && { reservationId: reservation.id }),
                        })
                      }
                    >
                      {b.parts.length > 1
                        ? `${t('videos.record')}: ${partText(part)}`
                        : t('videos.record')}
                    </button>
                    <LeftText left={left} />
                  </div>
                );
              })}
              {b.attemptsPerVideo !== null &&
                (reserveFor === b.id ? (
                  <ReserveForm
                    partTexts={b.parts.map(
                      (p, i) => `${t('videos.part', { n: i + 1 })}: ${partText(p)}`,
                    )}
                    left={b.attemptsLeft.map((n) => n ?? 0)}
                    othersOpen={b.reservations}
                    onCancel={() => setReserveFor(null)}
                    onReserve={async (parts) => {
                      const res = await api.guestReserve({
                        code,
                        battleId: b.id,
                        deviceCode: deviceCode(),
                        parts,
                        ...(base.recorderName && { recorderName: base.recorderName }),
                      });
                      addLocalReservations(
                        res.reservations.map((r) => ({
                          id: r.id,
                          battleId: b.id,
                          partIndex: r.partIndex,
                          round: r.round,
                          count: r.count,
                          takeover: r.takeover,
                          createdAt: r.createdAt,
                          deadlineAt: b.deadlineAt,
                          needsReport: false,
                          guest: {
                            code,
                            athleteName: athlete.displayName,
                            ...(base.recorderName && { recorderName: base.recorderName }),
                            formatName: b.formatName,
                            opponents: b.opponents,
                            partTexts: b.parts.map((p) => partText(p)),
                          },
                        })),
                      );
                      setReserveFor(null);
                      void lookup();
                    }}
                  />
                ) : (
                  <div className="actions">
                    <button type="button" className="secondary" onClick={() => setReserveFor(b.id)}>
                      {t('offline.prepareFilm')}
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </section>
      )}

      <PreparedBattles
        reservations={prepared}
        onRecord={(r, unitsLeft) =>
          r.guest &&
          setTarget({
            code: r.guest.code,
            athleteName: r.guest.athleteName,
            battleId: r.battleId,
            partIndex: r.partIndex,
            round: r.round,
            reservationId: r.id,
            attemptsLeft: unitsLeft,
            limited: true,
            ...(r.guest.recorderName && { recorderName: r.guest.recorderName }),
          })
        }
      />

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
          reservationId={target.reservationId}
          needsConnection={target.limited}
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

/** The reservations made on this phone with an athlete code, kept up to date. */
function useGuestReservations() {
  const [list, setList] = useState(() => localReservations().filter((r) => r.guest));
  useEffect(
    () => onReservationsChanged(() => setList(localReservations().filter((r) => r.guest))),
    [],
  );
  return list;
}

/**
 * Battles prepared for filming offline on this phone: recording works without a connection.
 * Back online, the upload queue reports and the deadline hands the rest back.
 */
function PreparedBattles({
  reservations,
  onRecord,
}: {
  reservations: LocalReservation[];
  onRecord: (r: LocalReservation, unitsLeft: number) => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const online = useOnline();
  if (reservations.length === 0) return null;
  const handBack = async (r: LocalReservation) => {
    if (!r.guest) return;
    setError(null);
    try {
      await api.guestReport(r.id, { code: r.guest.code, deviceCode: deviceCode(), handBack: true });
      removeLocalReservation(r.id);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section>
      <h2>{t('offline.filmTitle')}</h2>
      <p className="hint">{t('offline.filmHint')}</p>
      {reservations.map((r) => {
        const g = r.guest;
        if (!g) return null;
        const unitsLeft = Math.max(0, r.count - (r.recorded ?? 0));
        return (
          <div key={r.id} className="card">
            <strong>{g.athleteName}</strong>{' '}
            <span className="muted">
              {g.formatName} · {t('film.against', { names: g.opponents.join(', ') })}
              {r.deadlineAt !== null && ` · ${formatDate(r.deadlineAt)}`}
            </span>
            {g.partTexts.length > 1 && <div>{g.partTexts[r.partIndex]}</div>}
            <div className="actions">
              <button
                type="button"
                disabled={!isRecordingSupported()}
                onClick={() => onRecord(r, unitsLeft)}
              >
                {t('videos.record')}
              </button>
              <LeftText left={unitsLeft} />
              <button type="button" className="link" disabled={!online} onClick={() => handBack(r)}>
                {t('offline.handBack')}
              </button>
            </div>
          </div>
        );
      })}
      <ErrorText error={error} />
    </section>
  );
}
