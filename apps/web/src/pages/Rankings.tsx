import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserLink } from '../components/UserLink';
import { t } from '../i18n';

/** Ranking per format, sorted by r − 2·RD (rating specification §8.1). */
export function RankingsPage() {
  const { data: me } = useMe();
  const formats = useFormats();
  const [params, setParams] = useSearchParams();
  const list = formats.data?.formats ?? [];
  const formatId =
    params.get('format') ?? list.find((f) => f.status === 'relevant')?.id ?? list[0]?.id ?? '';
  const ranking = useQuery({
    queryKey: ['ranking', formatId],
    queryFn: () => api.ranking(formatId),
    enabled: formatId !== '',
  });

  return (
    <>
      <h1>{t('rankings.title')}</h1>
      <label>
        {t('new.format')}
        <select value={formatId} onChange={(e) => setParams({ format: e.target.value })}>
          {list.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{t('rankings.hint')}</p>
      <ErrorText error={ranking.error} />
      {ranking.data?.ranking.length === 0 && <p className="muted">{t('rankings.empty')}</p>}
      {(ranking.data?.ranking.length ?? 0) > 0 && (
        <table className="ranking">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('rankings.athlete')}</th>
              <th>{t('rankings.rating')}</th>
              <th>{t('rankings.battles')}</th>
            </tr>
          </thead>
          <tbody>
            {ranking.data?.ranking.map((e) => (
              <tr key={e.userId} className={e.userId === me?.id ? 'me' : undefined}>
                <td>{e.rank}</td>
                <td>
                  <UserLink id={e.userId} name={e.displayName} />
                </td>
                <td>
                  {e.r}
                  {e.provisional ? '?' : ''} <span className="muted">±{e.rd}</span>
                </td>
                <td>{e.nBattles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
