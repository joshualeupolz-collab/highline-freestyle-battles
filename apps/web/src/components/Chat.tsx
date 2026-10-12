import { MESSAGE_MAX_LENGTH } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type Message, type Participant } from '../api';
import { settingsText } from '../battleHelpers';
import { formatShort, type MessageKey, t } from '../i18n';
import { ErrorText } from './ErrorText';

/** How often new messages are fetched while the battle page is open and visible. */
const POLL_MS = 20_000;

/** Chat between the participants of a battle. Only they can read it. */
export function Chat({
  battleId,
  myId,
  participants,
}: {
  battleId: string;
  myId: string;
  participants: Participant[];
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['messages', battleId],
    queryFn: () => api.messages(battleId),
    // Only while the page is visible: polling in the background would waste free-tier requests.
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(battleId, body),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['messages', battleId] });
    },
  });
  const list = messages.data?.messages ?? [];
  const count = list.length;

  useEffect(() => {
    if (count > 0) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  const name = (id: string) => participants.find((p) => p.userId === id)?.displayName ?? '?';
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('chat.title')}</h2>
      <div className="chat" ref={listRef}>
        {list.length === 0 && <p className="muted">{t('chat.empty')}</p>}
        {list.map((m) =>
          m.event ? (
            <div key={m.id} className="chat-event">
              {eventText(m.event, m.senderId === myId ? t('chat.you') : name(m.senderId))}
              <span className="muted"> · {formatShort(m.createdAt)}</span>
            </div>
          ) : (
            <div key={m.id} className={`message${m.senderId === myId ? ' mine' : ''}`}>
              <div className="meta">
                {m.senderId === myId ? t('chat.you') : name(m.senderId)} ·{' '}
                {new Date(m.createdAt).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </div>
              <div className="body">{m.body}</div>
            </div>
          ),
        )}
      </div>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={t('chat.placeholder')}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={send.isPending || !text.trim()}>
          {t('chat.send')}
        </button>
      </form>
      <ErrorText error={send.error} />
      <p className="hint">{t('chat.privacy')}</p>
    </section>
  );
}

/** One line for an entry the app wrote, e.g. "Anna asks for more time (until Sun, 18 Oct)". */
function eventText(event: NonNullable<Message['event']>, who: string): string {
  const kind = event.kind ?? '';
  const payload = event.payload ?? {};
  switch (event.type) {
    case 'proposal': {
      let what: string;
      if (kind === 'settings')
        what = t('event.what.settings', { changes: settingsText(payload.changes ?? {}) });
      else if (kind === 'extension')
        what = t('event.what.extension', { date: formatShort(payload.deadlineAt ?? 0) });
      else if (kind === 'extra_attempt')
        what = payload.change === 1 ? t('event.what.askAttempt') : t('event.what.takeBack');
      else if (kind === 'result') {
        const v = payload.value ?? 0;
        what = t('event.what.result', {
          result: t(Math.abs(v) === 2 ? 'review.clearly' : 'review.somewhat', {
            name: v > 0 ? who : t('event.theOther'),
          }),
        });
      } else what = t('event.what.cancel');
      return t('event.proposal', { who, what });
    }
    case 'proposal_accepted':
    case 'proposal_rejected':
    case 'proposal_withdrawn':
      return t(`event.${event.type}` as MessageKey, {
        who,
        kind: t(`event.kind.${kind || 'settings'}` as MessageKey),
      });
    case 'official_confirmed':
      return t('event.official_confirmed', { who: event.name ?? who });
    case 'deadline_decision':
      return t(event.choice === 'claim_win' ? 'event.claimWin' : 'event.cancelUnrated', { who });
    default:
      return t(`event.${event.type}` as MessageKey, { who });
  }
}
