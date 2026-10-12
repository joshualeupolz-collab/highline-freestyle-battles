/**
 * Videos friends filmed offline with my athlete code (concept section 6): they wait here until
 * they are assigned to a battle that was running at the recording time. The opponent then
 * confirms that the video belongs to that battle.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type InboxItem } from '../api';
import { useMe } from '../auth';
import { partText } from '../battleHelpers';
import { formatDate, t } from '../i18n';
import { VideoPlayer, VideoSettings } from './BattleVideos';
import { ErrorText } from './ErrorText';

/** My inbox (shared query, also counted for the number on the app icon). */
export function useInbox(): InboxItem[] {
  const { data: me } = useMe();
  const query = useQuery({
    queryKey: ['inbox'],
    queryFn: api.inbox,
    enabled: me?.status === 'active',
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return query.data?.inbox ?? [];
}

export function Inbox() {
  const items = useInbox();
  if (items.length === 0) return null;
  return (
    <section>
      <h2>{t('inbox.title')}</h2>
      <p className="hint">{t('inbox.hint')}</p>
      {items.map((item) => (
        <InboxCard key={item.id} item={item} />
      ))}
    </section>
  );
}

function InboxCard({ item }: { item: InboxItem }) {
  const queryClient = useQueryClient();
  const [watch, setWatch] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const uploaded = item.video?.status === 'uploaded' || item.video?.status === 'ready';

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['inbox'] });
      await queryClient.invalidateQueries({ queryKey: ['myBattles'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <strong>
        {item.recorderName
          ? t('film.filmedBy', { name: item.recorderName })
          : t('film.filmedByFriend')}
      </strong>{' '}
      <span className="muted">{formatDate(item.recordedAt)}</span>
      {item.description && <div>“{item.description}”</div>}
      {!uploaded && <p className="muted">{t('inbox.notUploaded')}</p>}
      {uploaded && item.video && (
        <>
          <button type="button" className="secondary" onClick={() => setWatch(!watch)}>
            {watch ? t('videos.hide') : t('videos.watch')}
          </button>
          {watch && <VideoPlayer id={item.video.id} />}
          <VideoSettings video={item.video} />
        </>
      )}
      <p className="hint">
        {item.battles.length ? t('inbox.chooseBattle') : t('film.noBattlesThen')}
      </p>
      {item.battles.map((b) =>
        b.parts.map((part, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a format never change
          <div key={`${b.id}:${i}`} className="actions">
            <button
              type="button"
              disabled={busy || b.attemptsLeft[i] === 0}
              onClick={() => run(() => api.assignInbox(item.id, b.id, i))}
            >
              {b.formatName}
              {b.parts.length > 1 && ` (${partText(part)})`} ·{' '}
              {t('film.against', { names: b.opponents.join(', ') })}
            </button>
          </div>
        )),
      )}
      <ErrorText error={error} />
      <div className="actions">
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('inbox.deleteConfirm'))) void run(() => api.deleteInbox(item.id));
          }}
        >
          {t('videos.delete')}
        </button>
      </div>
    </div>
  );
}
