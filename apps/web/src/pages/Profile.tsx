import { PASSWORD_MIN } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useMe, useSetMe } from '../auth';
import { ErrorText } from '../components/ErrorText';
import { t } from '../i18n';

export function ProfilePage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      setCurrent('');
      setNew('');
    },
  });
  const logout = useMutation({ mutationFn: api.logout, onSettled: () => setMe(null) });
  if (!me) return null;

  return (
    <>
      <h1>{t('profile.title')}</h1>
      <div className="card">
        <dl>
          <dt>{t('field.username')}</dt>
          <dd>{me.username}</dd>
          <dt>{t('field.displayName')}</dt>
          <dd>{me.displayName}</dd>
          <dt>{t('profile.roles')}</dt>
          <dd>{me.roles.join(', ') || '–'}</dd>
        </dl>
      </div>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate({ currentPassword, newPassword });
        }}
      >
        <h2 style={{ marginTop: 0 }}>{t('profile.changePassword')}</h2>
        <label>
          {t('field.currentPassword')}
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          {t('field.newPassword')}
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
          />
        </label>
        <ErrorText error={change.error} />
        {change.isSuccess && <p className="success">{t('profile.passwordChanged')}</p>}
        <button type="submit" disabled={change.isPending}>
          {t('common.save')}
        </button>
      </form>
      <button type="button" className="danger" onClick={() => logout.mutate()}>
        {t('profile.logout')}
      </button>
    </>
  );
}
