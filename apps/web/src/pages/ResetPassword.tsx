import { PASSWORD_MIN } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { ErrorText } from '../components/ErrorText';
import { t } from '../i18n';

export function ResetPasswordPage() {
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const reset = useMutation({ mutationFn: api.resetPassword });

  return (
    <div className="card">
      <h1>{t('reset.title')}</h1>
      <p className="muted">{t('reset.hint')}</p>
      {reset.isSuccess ? (
        <p className="success">
          {t('reset.done')} <Link to="/login">{t('login.title')}</Link>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate({ code, newPassword });
          }}
        >
          <label>
            {t('reset.code')}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              required
            />
          </label>
          <label>
            {t('field.newPassword')}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
            />
          </label>
          <ErrorText error={reset.error} />
          <button type="submit" disabled={reset.isPending}>
            {t('reset.submit')}
          </button>
        </form>
      )}
    </div>
  );
}
