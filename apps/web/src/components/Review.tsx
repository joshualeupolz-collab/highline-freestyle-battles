/**
 * Review level 1 (concept section 7.1): both athletes vote on the 5-point scale. Votes are stored
 * seen from seat 0 (+2 = seat 0 clearly better … −2 = seat 1 clearly better).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Battle } from '../api';
import { formatShort, t } from '../i18n';
import { ErrorText } from './ErrorText';

export function ReviewCard({
  battle,
  myId,
  onVote,
  onEscalate,
  busy,
}: {
  battle: Battle;
  myId: string;
  onVote: (value: number) => void;
  onEscalate: () => void;
  busy: boolean;
}) {
  const review = battle.review;
  const [a, b] = [...battle.participants].sort((x, y) => x.seat - y.seat);
  if (battle.status !== 'reviewing' || !review || !a || !b) return null;
  if (review.level === 2)
    return (
      <div className="card notice">
        <h2 style={{ marginTop: 0 }}>{t('review.title')}</h2>
        <p>{t('review.pool', { n: review.poolCount, size: review.poolSize })}</p>
        <p className="hint">{t('review.poolHint')}</p>
      </div>
    );
  if (review.level === 3)
    return (
      <div className="card notice">
        <h2 style={{ marginTop: 0 }}>{t('review.title')}</h2>
        <p>{t('review.judge')}</p>
      </div>
    );
  const opponent = battle.participants.find((p) => p.userId !== myId);
  const mine = review.votes.find((v) => v.userId === myId)?.value;
  const theirs = review.votes.find((v) => v.userId !== myId)?.value;
  const opponentVoted = !!opponent && review.voted.includes(opponent.userId);

  const options = [
    { value: 2, label: t('review.clearly', { name: a.displayName }) },
    { value: 1, label: t('review.somewhat', { name: a.displayName }) },
    { value: 0, label: t('review.undecided') },
    { value: -1, label: t('review.somewhat', { name: b.displayName }) },
    { value: -2, label: t('review.clearly', { name: b.displayName }) },
  ];
  const labelOf = (value: number | undefined) => options.find((o) => o.value === value)?.label;

  let status: string;
  if (mine === undefined) status = t('review.pleaseVote');
  else if (theirs !== undefined)
    status = t('review.disagree', {
      mine: labelOf(mine) ?? '',
      theirs: labelOf(theirs) ?? '',
      name: opponent?.displayName ?? '',
    });
  else if (opponentVoted) status = '';
  else status = t('review.waiting', { name: opponent?.displayName ?? '' });

  return (
    <div className="card notice">
      <h2 style={{ marginTop: 0 }}>{t('review.title')}</h2>
      <p className="hint">{t('review.intro')}</p>
      <div className="vote-options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === mine ? '' : 'secondary'}
            disabled={busy}
            onClick={() => onVote(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {status && <p>{status}</p>}
      {review.canEscalate ? (
        <>
          <p className="hint">
            {t('review.escalateHint', { date: formatShort(review.endsAt ?? Date.now()) })}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => window.confirm(t('review.escalateConfirm')) && onEscalate()}
          >
            {t('review.escalate')}
          </button>
        </>
      ) : (
        review.endsAt && (
          <p className="muted">{t('review.endsAt', { date: formatShort(review.endsAt) })}</p>
        )
      )}
    </div>
  );
}

/**
 * For someone who reviews another battle: a pool member (level 2, one anonymous review) or a
 * judge (level 3, final decision, sees the earlier votes).
 */
export function ReviewerCard({ battle }: { battle: Battle }) {
  const queryClient = useQueryClient();
  const review = battle.review;
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: (value: number) =>
      review?.reviewerRole === 'judge'
        ? api.battleAction(battle.id, 'judge-decision', { value, note: note.trim() || undefined })
        : api.battleAction(battle.id, 'pool-vote', { value }),
    onSuccess: (res) => {
      queryClient.setQueryData(['battle', battle.id], res);
      return queryClient.invalidateQueries({ queryKey: ['openReviews'] });
    },
  });
  const [a, b] = [...battle.participants].sort((x, y) => x.seat - y.seat);
  if (battle.status !== 'reviewing' || !review?.reviewerRole || !a || !b) return null;
  const judge = review.reviewerRole === 'judge';
  if (!judge && review.myPoolVote !== null)
    return <p className="card success">{t('review.forPoolSent')}</p>;

  const options = [
    { value: 2, label: t('review.clearly', { name: a.displayName }) },
    { value: 1, label: t('review.somewhat', { name: a.displayName }) },
    ...(judge ? [] : [{ value: 0, label: t('review.undecided') }]),
    { value: -1, label: t('review.somewhat', { name: b.displayName }) },
    { value: -2, label: t('review.clearly', { name: b.displayName }) },
  ];
  const labelOf = (v: number) =>
    [2, 1, 0, -1, -2].includes(v)
      ? v === 0
        ? t('review.undecided')
        : t(Math.abs(v) === 2 ? 'review.clearly' : 'review.somewhat', {
            name: v > 0 ? a.displayName : b.displayName,
          })
      : '?';
  return (
    <div className="card notice">
      <h2 style={{ marginTop: 0 }}>
        {judge ? t('review.forJudgeTitle') : t('review.forPoolTitle')}
      </h2>
      <p className="hint">{judge ? t('review.forJudgeIntro') : t('review.forPoolIntro')}</p>
      {judge && (
        <>
          <p className="muted">
            {t('review.earlierVotes', {
              athletes: review.votes.map((v) => labelOf(v.value)).join(', ') || '–',
              pool: (review.poolVotes ?? []).map(labelOf).join(', ') || '–',
            })}
          </p>
          <label>
            {t('review.judgeNote')}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
        </>
      )}
      <div className="vote-options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="secondary"
            disabled={send.isPending}
            onClick={() =>
              (!judge || window.confirm(t('review.judgeConfirm'))) && send.mutate(o.value)
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <ErrorText error={send.error} />
    </div>
  );
}
