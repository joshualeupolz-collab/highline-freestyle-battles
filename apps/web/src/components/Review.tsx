/**
 * Review level 1 (concept section 7.1): both athletes vote on the 5-point scale. Votes are stored
 * seen from seat 0 (+2 = seat 0 clearly better … −2 = seat 1 clearly better).
 */

import type { Battle } from '../api';
import { formatDate, t } from '../i18n';

export function ReviewCard({
  battle,
  myId,
  onVote,
  busy,
}: {
  battle: Battle;
  myId: string;
  onVote: (value: number) => void;
  busy: boolean;
}) {
  const review = battle.review;
  const [a, b] = [...battle.participants].sort((x, y) => x.seat - y.seat);
  if (battle.status !== 'reviewing' || !review || !a || !b) return null;
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
      {review.endsAt && (
        <p className="muted">{t('review.endsAt', { date: formatDate(review.endsAt) })}</p>
      )}
    </div>
  );
}
