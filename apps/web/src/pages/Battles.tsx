import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type BattleSummary } from '../api';
import { useMe } from '../auth';
import { formatColor, StatusBadge, useFormatName } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { useOpenReviews } from '../components/Layout';
import { formatShort, type MessageKey, t } from '../i18n';
import { nextStep } from '../nextStep';

/** Start page: pending notice, or my battles grouped by what needs attention. */
export function BattlesPage() {
  const { data: me } = useMe();
  const battles = useQuery({
    queryKey: ['myBattles'],
    queryFn: api.myBattles,
    enabled: me?.status === 'active',
  });
  const formatName = useFormatName();

  if (me && me.status !== 'active') {
    return (
      <div className="card notice">
        <h1>{t('pending.title')}</h1>
        <p>{t('pending.text', { username: me.username })}</p>
      </div>
    );
  }
  if (battles.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const list = battles.data?.battles ?? [];

  const needsMe = (b: BattleSummary) =>
    b.unreadMessages > 0 || !!(me && nextStep(b, b.todo, me.id)?.urgent);
  const running = (b: BattleSummary) =>
    ['open', 'negotiating', 'active', 'reviewing'].includes(b.status);
  const groups = [
    { title: t('battles.actionNeeded'), items: list.filter(needsMe) },
    { title: t('battles.running'), items: list.filter((b) => running(b) && !needsMe(b)) },
    { title: t('battles.finished'), items: list.filter((b) => !running(b)) },
  ];

  return (
    <>
      <h1>{t('battles.title')}</h1>
      <OpenReviews />
      <ErrorText error={battles.error} />
      {list.length === 0 && <p className="muted">{t('battles.empty')}</p>}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map((b) => {
              const opponent = b.participants.find((p) => p.userId !== me?.id);
              const step = me ? nextStep(b, b.todo, me.id) : null;
              const myScore = b.participants.find((p) => p.userId === me?.id)?.score;
              const outcome =
                b.status !== 'decided' || myScore === null || myScore === undefined
                  ? null
                  : myScore > 0.5
                    ? 'won'
                    : myScore < 0.5
                      ? 'lost'
                      : 'draw';
              return (
                <Link
                  key={b.id}
                  to={`/battles/${b.id}`}
                  className={`card battle-card ${outcome ?? ''}`}
                  style={{ borderLeftColor: formatColor(b.formatId) }}
                >
                  <div className="row">
                    <strong>{formatName(b.formatId)}</strong>
                    <span>
                      {b.unreadMessages > 0 && (
                        <span className="badge unread">
                          {t('battles.newMessages', { n: b.unreadMessages })}
                        </span>
                      )}{' '}
                      {outcome ? (
                        <span className={`badge ${outcome}`}>
                          {t(`battles.${outcome}`)}
                          {b.ratingChange !== null &&
                            ` ${b.ratingChange >= 0 ? '+' : '−'}${Math.abs(Math.round(b.ratingChange))}`}
                        </span>
                      ) : (
                        <StatusBadge status={b.status} mode={b.mode} />
                      )}
                    </span>
                  </div>
                  <div className="muted">
                    {opponent
                      ? `${t('battles.vs')} ${opponent.displayName}`
                      : t('battles.waitingForOpponent')}
                    {b.deadlineAt && b.status === 'active'
                      ? ` · ${t('battles.until', { date: formatShort(b.deadlineAt) })}`
                      : ''}
                  </div>
                  {step && (
                    <div className={step.urgent ? 'next-line urgent' : 'next-line'}>
                      {t(step.key, { opponent: opponent?.displayName ?? '' })}
                    </div>
                  )}
                </Link>
              );
            })}
          </section>
        ))}
    </>
  );
}

/** Battles of others waiting for my review (pool or judge), concept 7.2: shown when the app opens. */
function OpenReviews() {
  const reviews = useOpenReviews();
  const formatName = useFormatName();
  if (reviews.length === 0) return null;
  return (
    <section>
      <h2>{t('reviews.title')}</h2>
      <p className="hint">{t('reviews.hint')}</p>
      {reviews.map((r) => (
        <Link
          key={r.battleId}
          to={`/battles/${r.battleId}`}
          className="card battle-card"
          style={{ borderLeftColor: formatColor(r.formatId) }}
        >
          <div className="row">
            <strong>{formatName(r.formatId)}</strong>
            <span className="badge reviewing">{t(`reviews.level.${r.level}` as MessageKey)}</span>
          </div>
          <div className="muted">
            {r.participants.map((p) => p.displayName).join(` ${t('battles.vs')} `)}
          </div>
        </Link>
      ))}
    </section>
  );
}
