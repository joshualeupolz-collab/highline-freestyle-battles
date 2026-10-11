import { PASSWORD_MIN } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useSetMe } from '../auth';
import { ErrorText } from '../components/ErrorText';
import { t } from '../i18n';

/** "I accept the terms of use and have read the privacy policy", with both as links. */
function TermsSentence() {
  // Split the translated sentence at its placeholders so the links stay inside it.
  const parts = t('register.terms').split(/(\{terms\}|\{privacy\})/);
  return (
    <>
      {parts.map((part) =>
        part === '{terms}' ? (
          <Link key={part} to="/terms" target="_blank">
            {t('legal.termsLink')}
          </Link>
        ) : part === '{privacy}' ? (
          <Link key={part} to="/privacy" target="_blank">
            {t('legal.privacyLink')}
          </Link>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function RegisterPage() {
  const setMe = useSetMe();
  // The setup field only appears with ?setup in the address (first admin).
  const [params] = useSearchParams();
  const showSetup = params.has('setup');
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    email: '',
    ageConfirmed: false,
    termsAccepted: false,
    freestyleSince: '',
    community: '',
    note: '',
    setupToken: '',
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const register = useMutation({ mutationFn: api.register, onSuccess: (res) => setMe(res.user) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const questionnaire = Object.fromEntries(
      (['freestyleSince', 'community', 'note'] as const)
        .filter((k) => form[k].trim())
        .map((k) => [k, form[k].trim()]),
    );
    register.mutate({
      username: form.username.trim(),
      displayName: form.displayName.trim() || form.username.trim(),
      password: form.password,
      email: form.email.trim() || undefined,
      ageConfirmed: form.ageConfirmed,
      termsAccepted: form.termsAccepted,
      questionnaire: Object.keys(questionnaire).length ? questionnaire : undefined,
      setupToken: form.setupToken || undefined,
    });
  };

  return (
    <div className="card">
      <h1>{t('register.title')}</h1>
      <form onSubmit={submit}>
        <label>
          {t('field.username')}
          <input
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
            required
            minLength={3}
            maxLength={30}
          />
        </label>
        <label>
          {t('field.displayName')}
          <input value={form.displayName} onChange={set('displayName')} maxLength={50} />
        </label>
        <label>
          {t('field.password')}
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
          />
          <span className="hint">{t('field.passwordHint')}</span>
        </label>
        <label>
          {t('field.email')}
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <fieldset className="card" style={{ display: 'grid', gap: '0.75rem' }}>
          <legend className="muted">{t('register.questionnaire')}</legend>
          <label>
            {t('register.freestyleSince')}
            <input value={form.freestyleSince} onChange={set('freestyleSince')} maxLength={100} />
          </label>
          <label>
            {t('register.community')}
            <input value={form.community} onChange={set('community')} maxLength={200} />
          </label>
          <label>
            {t('register.note')}
            <input value={form.note} onChange={set('note')} maxLength={500} />
          </label>
        </fieldset>
        {showSetup && (
          <label>
            {t('register.setupToken')}
            <input value={form.setupToken} onChange={set('setupToken')} />
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={form.ageConfirmed}
            onChange={set('ageConfirmed')}
            required
          />
          <span>
            {t('register.age')} <span className="hint">{t('register.ageHint')}</span>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.termsAccepted}
            onChange={set('termsAccepted')}
            required
          />
          <span>
            <TermsSentence />
          </span>
        </label>
        <ErrorText error={register.error} />
        <button type="submit" disabled={register.isPending}>
          {t('register.submit')}
        </button>
      </form>
      <p className="muted">
        {t('register.haveAccount')} <Link to="/login">{t('login.title')}</Link>
      </p>
    </div>
  );
}
