import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorText } from '../components/ErrorText';
import { formatDate, t } from '../i18n';

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const pending = useQuery({ queryKey: ['pendingUsers'], queryFn: api.pendingUsers });
  const approve = useMutation({
    mutationFn: api.approveUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pendingUsers'] }),
  });

  if (pending.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const list = pending.data?.users ?? [];
  return (
    <>
      <h1>{t('approvals.title')}</h1>
      <p className="muted">{t('approvals.hint')}</p>
      <ErrorText error={pending.error ?? approve.error} />
      {list.length === 0 && <p className="muted">{t('approvals.empty')}</p>}
      {list.map((u) => (
        <div key={u.id} className="card">
          <div className="row">
            <strong>
              {u.displayName} <span className="muted">@{u.username}</span>
            </strong>
            <span className="muted">{formatDate(u.createdAt)}</span>
          </div>
          {u.questionnaire && (
            <dl style={{ marginTop: '0.5rem' }}>
              {u.questionnaire.freestyleSince && (
                <>
                  <dt>{t('register.freestyleSince')}</dt>
                  <dd>{u.questionnaire.freestyleSince}</dd>
                </>
              )}
              {u.questionnaire.community && (
                <>
                  <dt>{t('register.community')}</dt>
                  <dd>{u.questionnaire.community}</dd>
                </>
              )}
              {u.questionnaire.note && (
                <>
                  <dt>{t('register.note')}</dt>
                  <dd>{u.questionnaire.note}</dd>
                </>
              )}
            </dl>
          )}
          <div className="actions">
            <button type="button" onClick={() => approve.mutate(u.id)} disabled={approve.isPending}>
              {t('approvals.approve')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
