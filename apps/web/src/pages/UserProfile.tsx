import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { StatusBadge } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserLink } from '../components/UserLink';
import { formatDate, t } from '../i18n';

export function UserProfilePage() {
  const { id = '' } = useParams();
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api.profile(id) });
  if (profile.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const data = profile.data;
  if (!data) return <ErrorText error={profile.error} />;
  const { user, ratings, battles } = data;

  return (
    <>
      <h1 style={{ marginBottom: 0 }}>{user.displayName}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        @{user.username} ·{' '}
        {t('profile.memberSince', { date: new Date(user.createdAt).toLocaleDateString() })}
        {user.approvedBy && (
          <>
            {' · '}
            {t('profile.approvedBy')}{' '}
            <UserLink id={user.approvedBy.id} name={user.approvedBy.displayName} />
          </>
        )}
      </p>

      <h2>{t('profile.ratings')}</h2>
      {ratings.length === 0 && <p className="muted">{t('profile.noRatings')}</p>}
      <div className="tiles">
        {ratings.map((r) => (
          <Link key={r.formatId} to={`/rankings?format=${r.formatId}`} className="tile">
            <span>{r.formatName}</span>
            <strong className="big">
              {r.r}
              {r.provisional ? ` · ${t('rating.provisional')}` : ''}
            </strong>
            <span>
              ±{r.rd} · {t('profile.battleCount', { n: r.nBattles })}
            </span>
          </Link>
        ))}
      </div>

      <h2>{t('profile.recentBattles')}</h2>
      {battles.length === 0 && <p className="muted">{t('battles.empty')}</p>}
      {battles.map((b) => (
        <Link key={b.id} to={`/battles/${b.id}`} className="card">
          <div className="row">
            <strong>{b.formatName ?? '…'}</strong>
            {b.status === 'decided' ? (
              <span className={b.score === 1 ? 'success' : b.score === 0 ? 'error' : 'muted'}>
                {b.score === 1
                  ? t('profile.win')
                  : b.score === 0
                    ? t('profile.loss')
                    : `${b.score}`}
                {b.ratingChange !== null && ` (${b.ratingChange >= 0 ? '+' : ''}${b.ratingChange})`}
              </span>
            ) : (
              <StatusBadge status={b.status} />
            )}
          </div>
          <div className="muted">
            {t('battles.vs')} {b.opponents.map((o) => o.displayName).join(', ') || '–'} ·{' '}
            {formatDate(b.decidedAt ?? b.createdAt)}
          </div>
        </Link>
      ))}
    </>
  );
}
