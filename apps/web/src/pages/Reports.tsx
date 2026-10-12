/**
 * Reports: everyone sees their own; the federation and admins also handle the open ones
 * (concept section 11).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, type ReportEntry } from '../api';
import { hasRole, useMe } from '../auth';
import { ErrorText } from '../components/ErrorText';
import { UserLink } from '../components/UserLink';
import { formatDate, type MessageKey, t } from '../i18n';

const targetLink = (r: { targetType: string; targetId: string; battleId?: string | null }) =>
  r.targetType === 'user'
    ? `/users/${r.targetId}`
    : `/battles/${r.targetType === 'battle' ? r.targetId : (r.battleId ?? '')}`;

export function ReportsPage() {
  const { data: me } = useMe();
  const staff = hasRole(me, 'federation', 'admin');
  return (
    <>
      <h1>{t('reports.title')}</h1>
      {staff && <StaffReports />}
      <MyReports />
    </>
  );
}

function MyReports() {
  const mine = useQuery({ queryKey: ['myReports'], queryFn: api.myReports });
  const list = mine.data?.reports ?? [];
  return (
    <section>
      <h2>{t('reports.mine')}</h2>
      <ErrorText error={mine.error} />
      {mine.isSuccess && list.length === 0 && <p className="muted">{t('reports.mineEmpty')}</p>}
      {list.map((r) => (
        <div key={r.id} className="card">
          <div className="row">
            <strong>{t(`report.category.${r.category}` as MessageKey)}</strong>
            <span className={`badge ${r.status === 'open' ? 'negotiating' : 'decided'}`}>
              {t(`reports.status.${r.status}` as MessageKey)}
            </span>
          </div>
          <div className="muted">
            {t(`report.target.${r.targetType}` as MessageKey)} · {formatDate(r.createdAt)}
          </div>
          <p style={{ margin: '0.25rem 0 0' }}>{r.text}</p>
        </div>
      ))}
    </section>
  );
}

function StaffReports() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const list = useQuery({ queryKey: ['reports', status], queryFn: () => api.reports(status) });
  const reports = list.data?.reports ?? [];
  return (
    <section>
      <div className="row">
        <h2>{status === 'open' ? t('reports.open') : t('reports.closed')}</h2>
        <button
          type="button"
          className="link"
          onClick={() => setStatus(status === 'open' ? 'closed' : 'open')}
        >
          {status === 'open' ? t('reports.showClosed') : t('reports.showOpen')}
        </button>
      </div>
      <ErrorText error={list.error} />
      {list.isSuccess && reports.length === 0 && <p className="muted">{t('reports.empty')}</p>}
      {reports.map((r) => (
        <StaffReport key={r.id} report={r} />
      ))}
    </section>
  );
}

function StaffReport({ report: r }: { report: ReportEntry }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () => api.closeReport(r.id, note.trim()),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
        queryClient.invalidateQueries({ queryKey: ['openReportCount'] }),
      ]),
  });
  return (
    <div className="card">
      <div className="row">
        <strong>{t(`report.category.${r.category}` as MessageKey)}</strong>
        <span className="muted">{formatDate(r.createdAt)}</span>
      </div>
      <div className="muted">
        {r.reporter && t('reports.by', { name: r.reporter.displayName })} ·{' '}
        <Link to={targetLink(r)}>
          {t('reports.openTarget')} ({t(`report.target.${r.targetType}` as MessageKey)})
        </Link>
      </div>
      {r.involved.length > 0 && (
        <div className="muted">
          {t('reports.concerns')}{' '}
          {r.involved.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <UserLink id={p.id} name={p.displayName} />
            </span>
          ))}
        </div>
      )}
      <p style={{ margin: '0.25rem 0' }}>{r.text}</p>
      {r.status === 'closed' ? (
        <p className="hint">
          {t('reports.closedBy', { name: r.closedBy?.displayName ?? '?', note: r.closeNote ?? '' })}
        </p>
      ) : r.canHandle ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close.mutate();
          }}
        >
          <label>
            {t('reports.closeNote')}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              minLength={3}
              maxLength={1000}
            />
          </label>
          <ErrorText error={close.error} />
          <button type="submit" disabled={close.isPending}>
            {t('reports.close')}
          </button>
        </form>
      ) : (
        <p className="hint">{t('reports.involved')}</p>
      )}
    </div>
  );
}
