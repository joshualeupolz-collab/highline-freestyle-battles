import { grantableRoles, type Role, SPECIAL_ROLES, type SpecialRole } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { StatusBadge } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { ReportButton } from '../components/ReportButton';
import { UserLink } from '../components/UserLink';
import { formatDate, type MessageKey, t } from '../i18n';

const roleName = (role: string) => t(`role.${role}` as MessageKey);

export function UserProfilePage() {
  const { id = '' } = useParams();
  const { data: currentUser } = useMe();
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api.profile(id) });
  if (profile.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const data = profile.data;
  if (!data) return <ErrorText error={profile.error} />;
  const { user, ratings, battles } = data;
  const me = currentUser;

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
      {user.roles.some((r) => r !== 'athlete') && (
        <div className="chips">
          {user.roles
            .filter((r) => r !== 'athlete')
            .map((r) => (
              <span key={r} className="chip">
                {roleName(r)}
              </span>
            ))}
        </div>
      )}
      <RolesCard userId={user.id} roles={user.roles as Role[]} />

      <h2>{t('profile.ratings')}</h2>
      {ratings.length === 0 && <p className="muted">{t('profile.noRatings')}</p>}
      <div className="tiles">
        {ratings.map((r) => (
          <Link key={r.formatId} to={`/rankings?format=${r.formatId}`} className="tile">
            <span>{r.formatName}</span>
            <strong className="big">
              {r.r}
              {r.provisional ? '?' : ''}
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
      {me && me.id !== user.id && <ReportButton targetType="user" targetId={user.id} />}
    </>
  );
}

/** Hand out and take back special roles (federation and admins, never for oneself). */
function RolesCard({ userId, roles }: { userId: string; roles: Role[] }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: ({ role, grant }: { role: SpecialRole; grant: boolean }) => {
      const reason = window.prompt(t('roles.reasonPrompt'));
      if (reason === null) return Promise.resolve(null);
      return grant
        ? api.grantRole(userId, role, reason.trim() || undefined)
        : api.revokeRole(userId, role, reason.trim() || undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });
  const allowed = me && me.id !== userId ? grantableRoles(me.roles) : [];
  if (allowed.length === 0) return null;
  return (
    <details className="card more">
      <summary>{t('roles.title')}</summary>
      <p className="hint">{t('roles.hint')}</p>
      <div className="actions">
        {SPECIAL_ROLES.filter((r) => allowed.includes(r)).map((role) => {
          const held = roles.includes(role);
          return (
            <button
              key={role}
              type="button"
              className={held ? 'danger' : 'secondary'}
              disabled={change.isPending}
              onClick={() => change.mutate({ role, grant: !held })}
            >
              {t(held ? 'roles.revoke' : 'roles.grant', { role: roleName(role) })}
            </button>
          );
        })}
      </div>
      <ErrorText error={change.error} />
    </details>
  );
}
