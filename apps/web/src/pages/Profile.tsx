import { PASSWORD_MIN } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { hasRole, useMe, useSetMe } from '../auth';
import { ErrorText } from '../components/ErrorText';
import { useOpenReportCount, usePendingCount } from '../components/Layout';
import { type MessageKey, t } from '../i18n';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isPushSupported,
  needsInstallForPush,
} from '../push';
import { LegalLinks } from './Legal';

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
  const logout = useMutation({
    mutationFn: async () => {
      await disablePush();
      return api.logout();
    },
    onSettled: () => setMe(null),
  });
  const navigate = useNavigate();
  const [deletePassword, setDeletePassword] = useState('');
  const [keepVideos, setKeepVideos] = useState(true);
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: (res) => {
      setMe(null);
      navigate('/deletion-request', { state: { token: res.deletionToken } });
    },
  });
  const canApprove = hasRole(me, 'athlete', 'federation', 'admin');
  const pending = usePendingCount(canApprove);
  const reports = useOpenReportCount(hasRole(me, 'federation', 'admin'));
  if (!me) return null;

  return (
    <>
      <h1>{t('profile.title')}</h1>
      <div className="link-list">
        <Link to={`/users/${me.id}`}>{t('profile.viewPublic')}</Link>
        {canApprove && (
          <Link to="/approvals">
            {t('nav.approvals')}
            {pending > 0 && <span className="count-badge">{pending}</span>}
          </Link>
        )}
        <Link to="/formats/propose">{t('new.proposeFormat')}</Link>
        <Link to="/competitions">{t('competitions.title')}</Link>
        {hasRole(me, 'federation', 'admin') && <Link to="/admin">{t('nav.admin')}</Link>}
        <Link to="/reports">
          {t('reports.title')}
          {reports > 0 && <span className="count-badge">{reports}</span>}
        </Link>
        {/* The installed app has no address bar, so testers reach the test page from here. */}
        <Link to="/lab/video">{t('profile.videoTest')}</Link>
      </div>
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
      <PushCard />
      <details className="card more">
        <summary>{t('profile.changePassword')}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ currentPassword, newPassword });
          }}
        >
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
      </details>
      <button type="button" className="danger" onClick={() => logout.mutate()}>
        {t('profile.logout')}
      </button>

      <details className="card more">
        <summary>{t('profile.delete')}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm(t('profile.deleteConfirm')))
              remove.mutate({ password: deletePassword, keepVideos });
          }}
        >
          <p className="hint">{t('profile.deleteHint')}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={keepVideos}
              onChange={(e) => setKeepVideos(e.target.checked)}
            />
            <span>{t('profile.keepVideos')}</span>
          </label>
          <label>
            {t('field.password')}
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <ErrorText error={remove.error} />
          <button type="submit" className="danger" disabled={remove.isPending}>
            {t('profile.deleteButton')}
          </button>
        </form>
      </details>
      <LegalLinks />
    </>
  );
}

/** Turn push notifications on or off for this device. */
function PushCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentSubscription()
      .then((sub) => setOn(!!sub))
      .catch(() => setOn(false));
  }, []);
  if (!isPushSupported())
    return (
      <div className="card">
        <strong>{t('push.title')}</strong>
        <p className="hint">
          {needsInstallForPushSafe() ? t('push.installFirst') : t('push.unsupported')}
        </p>
      </div>
    );
  const toggle = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        const why = await enablePush();
        if (why) setProblem(t(`push.${why}` as MessageKey));
        else setOn(true);
      }
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <strong>{t('push.title')}</strong>
      <p className="hint">{on ? t('push.on') : t('push.hint')}</p>
      {needsInstallForPush() && !on && <p className="hint">{t('push.installFirst')}</p>}
      {problem && <p className="error">{problem}</p>}
      <button
        type="button"
        className={on ? 'secondary' : ''}
        disabled={busy || on === null}
        onClick={toggle}
      >
        {on ? t('push.disable') : t('push.enable')}
      </button>
    </div>
  );
}

/** On iPhones in Safari (not installed) the push API is missing: explain why. */
function needsInstallForPushSafe(): boolean {
  try {
    return needsInstallForPush();
  } catch {
    return false;
  }
}
