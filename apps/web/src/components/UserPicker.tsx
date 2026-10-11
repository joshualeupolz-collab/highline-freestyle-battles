import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type UserHit } from '../api';
import { t } from '../i18n';

/** Search field for an active user (by the start of the username). */
export function UserPicker({
  value,
  onChange,
  excludeId,
}: {
  value: UserHit | null;
  onChange: (user: UserHit | null) => void;
  excludeId?: string;
}) {
  const [query, setQuery] = useState('');
  const search = useQuery({
    queryKey: ['userSearch', query],
    queryFn: () => api.searchUsers(query),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="row">
        <span>
          <strong>{value.displayName}</strong> <span className="muted">@{value.username}</span>
        </span>
        <button type="button" className="secondary" onClick={() => onChange(null)}>
          {t('common.clear')}
        </button>
      </div>
    );
  }
  const hits = (search.data?.users ?? []).filter((u) => u.id !== excludeId);
  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('common.searchUser')}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onChange(u)}>
                {u.displayName} <span className="muted">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
