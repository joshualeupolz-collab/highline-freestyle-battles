import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { compactSettings, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserLink } from '../components/UserLink';
import { t } from '../i18n';

export function OpenRequestsPage() {
  const navigate = useNavigate();
  const requests = useQuery({ queryKey: ['openRequests'], queryFn: api.openRequests });
  const formats = useFormats();
  const formatOf = (id: string) => formats.data?.formats.find((f) => f.id === id);
  const accept = useMutation({
    mutationFn: (id: string) => api.battleAction(id, 'accept'),
    onSuccess: (res) => navigate(`/battles/${res.battle.id}`),
  });

  if (requests.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const list = requests.data?.requests ?? [];
  return (
    <>
      <h1>{t('open.title')}</h1>
      <ErrorText error={requests.error ?? accept.error} />
      {list.length === 0 && <p className="muted">{t('open.empty')}</p>}
      {list.map((r) => (
        <div key={r.id} className="card">
          <div className="row">
            <strong>{formatOf(r.formatId)?.name ?? '…'}</strong>
            <span>
              {r.direct && <span className="badge active">{t('open.direct')}</span>}{' '}
              <span className={`badge ${r.settingsFlexible ? 'negotiating' : 'fixed'}`}>
                {r.settingsFlexible ? t('rules.flexible') : t('rules.fixed')}
              </span>
            </span>
          </div>
          <div>
            <UserLink id={r.challenger.userId} name={r.challenger.displayName} />{' '}
            <span className="muted">
              {r.challenger.rating
                ? `${Math.round(r.challenger.rating.r)} ±${Math.round(r.challenger.rating.rd)}`
                : t('rating.new')}
            </span>
          </div>
          <div className="muted">{compactSettings(r.settings, formatOf(r.formatId))}</div>
          <div className="hint">
            {r.settingsFlexible ? t('rules.flexibleHint') : t('rules.fixedHint')}
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                (r.settingsFlexible || window.confirm(t('battle.bindingConfirm'))) &&
                accept.mutate(r.id)
              }
              disabled={accept.isPending}
            >
              {r.settingsFlexible ? t('battle.acceptNegotiable') : t('open.accept')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
