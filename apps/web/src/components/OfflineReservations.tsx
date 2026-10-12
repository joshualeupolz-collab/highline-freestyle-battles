/**
 * Offline recording with reserved attempts (concept section 6, decided 2026-10-12): "Prepare for
 * offline recording" while online, the reservations of a battle, and handing back unused ones.
 * Used on the battle page and on the friend's page `/film`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Battle, type BattleReservation, type Format } from '../api';
import { partText } from '../battleHelpers';
import { formatDate, t } from '../i18n';
import { addLocalReservations, deviceCode, removeLocalReservation } from '../video/device';
import { ErrorText } from './ErrorText';

const ROUND = 1;

/** Whether the browser thinks it has a connection, kept up to date. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * The form: how many attempts to reserve per part (default: all free ones). With nothing free
 * but attempts reserved elsewhere, it warns that taken-over attempts stay provisional.
 */
export function ReserveForm({
  partTexts,
  left,
  othersOpen,
  onReserve,
  onCancel,
}: {
  partTexts: string[];
  /** Free attempts per part. */
  left: number[];
  /** Open reservations of other devices, per part. */
  othersOpen: { partIndex: number; count: number; createdAt: number }[];
  onReserve: (parts: { partIndex: number; round: number; count: number }[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [counts, setCounts] = useState(left.map((n) => Math.max(1, n)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const online = useOnline();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReserve(counts.map((count, partIndex) => ({ partIndex, round: ROUND, count })));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card notice">
      <h3 style={{ marginTop: 0 }}>{t('offline.prepareTitle')}</h3>
      <p>{t('offline.warning')}</p>
      {partTexts.map((text, i) => {
        const free = left[i] ?? 0;
        const elsewhere = othersOpen.filter((r) => r.partIndex === i);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format never change
          <div key={i}>
            <label>
              {partTexts.length > 1 ? text : t('offline.howMany')}
              <input
                type="number"
                min={1}
                max={99}
                value={counts[i] ?? 1}
                onChange={(e) =>
                  setCounts(counts.map((c, k) => (k === i ? Number(e.target.value) || 1 : c)))
                }
              />
            </label>
            <p className="muted" style={{ margin: 0 }}>
              {t('offline.free', { n: free })}
            </p>
            {(counts[i] ?? 1) > free && (
              <p className="hint">
                {elsewhere.length > 0
                  ? t('offline.takeoverWarning', {
                      times: elsewhere
                        .map((r) =>
                          t('offline.since', { n: r.count, date: formatDate(r.createdAt) }),
                        )
                        .join(', '),
                    })
                  : t('offline.beyondWarning')}
              </p>
            )}
          </div>
        );
      })}
      <ErrorText error={error} />
      <div className="actions">
        <button type="button" disabled={busy || !online} onClick={submit}>
          {t('offline.reserve')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** The athlete's "Prepare for offline recording" on the battle page. */
export function PrepareOffline({
  battle,
  format,
  myId,
  left,
}: {
  battle: Battle;
  format: Format;
  myId: string;
  left: (partIndex: number) => number | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const mine = deviceCode();
  if (!open)
    return (
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={!online}
          onClick={() => setOpen(true)}
        >
          {t('offline.prepare')}
        </button>
      </div>
    );
  const othersOpen = (battle.videos.reservations ?? []).filter(
    (r) => r.userId === myId && r.closedAt === null && r.deviceCode !== mine,
  );
  return (
    <ReserveForm
      partTexts={format.parts.map((p, i) => `${t('videos.part', { n: i + 1 })}: ${partText(p)}`)}
      left={format.parts.map((_, i) => left(i) ?? 0)}
      othersOpen={othersOpen}
      onCancel={() => setOpen(false)}
      onReserve={async (parts) => {
        const before = new Set((battle.videos.reservations ?? []).map((r) => r.id));
        const res = await api.reserveAttempts(battle.id, { deviceCode: mine, parts });
        queryClient.setQueryData(['battle', battle.id], res);
        void queryClient.invalidateQueries({ queryKey: ['battle', battle.id] });
        addLocalReservations(
          res.battle.videos.reservations
            .filter((r) => !before.has(r.id) && r.deviceCode === mine)
            .map((r) => ({
              id: r.id,
              battleId: battle.id,
              partIndex: r.partIndex,
              round: r.round,
              count: r.count,
              takeover: r.takeover,
              createdAt: r.createdAt,
              deadlineAt: battle.deadlineAt,
              needsReport: false,
            })),
        );
        setOpen(false);
      }}
    />
  );
}

/** One line about a reservation: how many, where, since when, how many recorded. */
function reservationText(r: BattleReservation, here: boolean) {
  const where = r.friend
    ? r.friend.name
      ? t('offline.byFriend', { name: r.friend.name })
      : t('offline.byAFriend')
    : here
      ? t('offline.thisDevice')
      : t('offline.otherDevice', { label: r.deviceLabel });
  const what =
    r.count === 0
      ? t('offline.takenOver', { n: r.requested })
      : t('offline.reserved', { n: r.count });
  const state =
    r.closedAt !== null
      ? t('offline.closed', { used: r.used })
      : r.reportedAt !== null
        ? t('offline.reported', { used: r.used, date: formatDate(r.reportedAt) })
        : t('offline.notReported');
  return `${what} · ${where} · ${t('offline.sinceDate', { date: formatDate(r.createdAt) })} · ${state}`;
}

/** The athlete's own reservations, with "Hand back" for the open ones of this device. */
export function MyReservations({
  battle,
  myId,
  format,
}: {
  battle: Battle;
  myId: string;
  format: Format;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const mine = deviceCode();
  const list = (battle.videos.reservations ?? []).filter((r) => r.userId === myId);
  if (list.length === 0) return null;
  const handBack = async (id: string) => {
    setError(null);
    try {
      const res = await api.reportReservation(battle.id, id, { deviceCode: mine, handBack: true });
      queryClient.setQueryData(['battle', battle.id], res);
      removeLocalReservation(id);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('offline.title')}</h3>
      {list.map((r) => (
        <div key={r.id} className="attempt">
          <div>
            {format.parts.length > 1 && (
              <strong>{t('videos.part', { n: r.partIndex + 1 })} </strong>
            )}
            <span className={r.closedAt === null ? '' : 'muted'}>
              {reservationText(r, r.deviceCode === mine)}
            </span>
          </div>
          {r.closedAt === null && r.deviceCode === mine && battle.status === 'active' && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => handBack(r.id)}>
                {t('offline.handBack')}
              </button>
            </div>
          )}
        </div>
      ))}
      <ErrorText error={error} />
    </div>
  );
}

/** The opponent's open reservations and reservations never reported (lost devices). */
export function OpponentReservations({ battle, userId }: { battle: Battle; userId: string }) {
  const open = (battle.videos.reservations ?? []).filter(
    (r) => r.userId === userId && r.closedAt === null,
  );
  const lost = battle.participants.find((p) => p.userId === userId)?.lostReservations ?? 0;
  if (open.length === 0 && lost === 0) return null;
  return (
    <>
      {open.map((r) => (
        <p key={r.id} className="muted" style={{ margin: 0 }}>
          {t('offline.opponentReserved', { text: reservationText(r, false) })}
        </p>
      ))}
      {lost > 0 && <LostHint n={lost} />}
    </>
  );
}

/** "Reservations never reported back" (concept section 6: a lost device, e.g. app deleted). */
export function LostHint({ n }: { n: number }) {
  return (
    <p className="hint" style={{ margin: 0 }}>
      {t('offline.lost', { n })}
    </p>
  );
}
