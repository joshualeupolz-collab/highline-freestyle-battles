import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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

  const combined = params.get('view') === 'combined';
  return (
    <>
      <h1>{t('rankings.title')}</h1>
      <fieldset className="segmented" aria-label={t('rankings.title')}>
        <button type="button" className={combined ? '' : 'on'} onClick={() => setParams({})}>
          {t('rankings.mode.format')}
        </button>
        <button
          type="button"
          className={combined ? 'on' : ''}
          onClick={() => setParams({ view: 'combined' })}
        >
          {t('rankings.mode.combined')}
        </button>
      </fieldset>
      {combined ? (
        <CombinedRankingView />
      ) : (
        <>
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
      )}
    </>
  );
}

/** Combined ranking (rating specification §8.2): the official one, or formats chosen freely. */
function CombinedRankingView() {
  const { data: me } = useMe();
  const formats = useFormats();
  const [choice, setChoice] = useState<{ formats: string[]; drop: number } | null>(null);
  const ranking = useQuery({
    queryKey: ['combinedRanking', choice],
    queryFn: () => api.combinedRanking(choice ?? undefined),
    enabled: !choice || choice.formats.length > 0,
  });
  const data = ranking.data;
  const list = formats.data?.formats ?? [];
  const toggle = (id: string) => {
    const current = choice ?? {
      formats: data?.formats.map((f) => f.id) ?? [],
      drop: data?.dropWorst ?? 0,
    };
    const next = current.formats.includes(id)
      ? current.formats.filter((f) => f !== id)
      : [...current.formats, id];
    setChoice({ formats: next, drop: Math.min(current.drop, Math.max(0, next.length - 1)) });
  };
  const selected = choice?.formats ?? data?.formats.map((f) => f.id) ?? [];

  return (
    <>
      {data && (
        <p>
          {t(data.official ? 'rankings.official' : 'rankings.custom', {
            formats: data.formats.map((f) => f.name).join(', '),
            n: data.dropWorst,
          })}
        </p>
      )}
      <p className="hint">{t('rankings.combinedHint')}</p>
      <details className="card more">
        <summary>{t('rankings.choose')}</summary>
        {list.map((f) => (
          <label key={f.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(f.id)}
              onChange={() => toggle(f.id)}
            />
            <span>{f.name}</span>
          </label>
        ))}
        <label>
          {t('rankings.drop')}
          <select
            value={choice?.drop ?? data?.dropWorst ?? 0}
            onChange={(e) => setChoice({ formats: selected, drop: Number(e.target.value) })}
          >
            {[...Array(Math.max(1, selected.length)).keys()].map((n) => (
              <option key={`drop-${n}`} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {choice && (
          <button type="button" className="link" onClick={() => setChoice(null)}>
            {t('rankings.useOfficial')}
          </button>
        )}
      </details>
      <ErrorText error={ranking.error} />
      {data?.ranking.length === 0 && <p className="muted">{t('rankings.empty')}</p>}
      {(data?.ranking.length ?? 0) > 0 && (
        <table className="ranking">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('rankings.athlete')}</th>
              <th>{t('rankings.value')}</th>
              <th>{t('rankings.formats')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.ranking.map((e) => (
              <tr key={e.userId} className={e.userId === me?.id ? 'me' : undefined}>
                <td>{e.rank}</td>
                <td>
                  <UserLink id={e.userId} name={e.displayName} />
                  <div className="muted small">
                    {data.formats
                      .map(
                        (f, i) =>
                          `${f.name} ${e.z[i] === null || e.z[i] === undefined ? '–' : e.z[i]?.toFixed(2)}`,
                      )
                      .join(' · ')}
                  </div>
                </td>
                <td>{e.value.toFixed(2)}</td>
                <td>
                  {e.formatsPlayed}/{data.formats.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
