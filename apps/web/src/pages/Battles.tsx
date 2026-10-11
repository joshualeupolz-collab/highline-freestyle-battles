import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type BattleSummary } from '../api';
import { useMe } from '../auth';
import { StatusBadge, useFormatName } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { formatDate, t } from '../i18n';

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
    b.deadlinePassed ||
    (b.status === 'open' && b.invitedUserId === me?.id) ||
    b.status === 'negotiating';
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
      <ErrorText error={battles.error} />
      {list.length === 0 && <p className="muted">{t('battles.empty')}</p>}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map((b) => {
              const opponent = b.participants.find((p) => p.userId !== me?.id);
              return (
                <Link key={b.id} to={`/battles/${b.id}`} className="card">
                  <div className="row">
                    <strong>{formatName(b.formatId)}</strong>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="muted">
                    {opponent
                      ? `${t('battles.vs')} ${opponent.displayName}`
                      : t('battles.waitingForOpponent')}
                    {b.deadlineAt && b.status === 'active'
                      ? ` · ${t('battle.deadline')}: ${formatDate(b.deadlineAt)}`
                      : ''}
                  </div>
                </Link>
              );
            })}
          </section>
        ))}
    </>
  );
}
