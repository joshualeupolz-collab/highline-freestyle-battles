import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useSetMe } from '../auth';
import { ErrorText } from '../components/ErrorText';
import { t } from '../i18n';

export function LoginPage() {
  const setMe = useSetMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: api.login, onSuccess: (res) => setMe(res.user) });

  return (
    <div className="card">
      <h1>{t('login.title')}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ username, password });
        }}
      >
        <label>
          {t('field.username')}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          {t('field.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <ErrorText error={login.error} />
        <button type="submit" disabled={login.isPending}>
          {t('login.submit')}
        </button>
      </form>
      <p className="muted">
        {t('login.noAccount')} <Link to="/register">{t('login.register')}</Link> ·{' '}
        <Link to="/reset-password">{t('login.forgot')}</Link>
      </p>
    </div>
  );
}
