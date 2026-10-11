import { useMutation } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../api';
import { ErrorText } from '../components/ErrorText';
import { t } from '../i18n';

/**
 * Public page after deleting an account, and the target of the deletion link (concept section
 * 12): with the link, a person can later have the videos they kept deleted too.
 */
export function DeletionRequestPage() {
  const location = useLocation();
  const [params] = useSearchParams();
  const fresh = (location.state as { token?: string } | null)?.token;
  const token = params.get('token') ?? fresh;
  const remove = useMutation({ mutationFn: (value: string) => api.deletionRequest(value) });
  const link = token ? `${window.location.origin}/deletion-request?token=${token}` : null;

  return (
    <main>
      <h1>{t('deletion.title')}</h1>
      {fresh && link && (
        <div className="card notice">
          <p>{t('deletion.done')}</p>
          <p className="code" style={{ wordBreak: 'break-all' }}>
            {link}
          </p>
          <p className="hint">{t('deletion.keepLink')}</p>
        </div>
      )}
      {token && (
        <div className="card">
          <p>{t('deletion.videosHint')}</p>
          {remove.isSuccess ? (
            <p className="success">{t('deletion.videosDeleted')}</p>
          ) : (
            <button
              type="button"
              className="danger"
              disabled={remove.isPending}
              onClick={() => window.confirm(t('deletion.confirm')) && remove.mutate(token)}
            >
              {t('deletion.deleteVideos')}
            </button>
          )}
          <ErrorText error={remove.error} />
        </div>
      )}
      <p>
        <Link to="/login">{t('appName')}</Link>
      </p>
    </main>
  );
}
