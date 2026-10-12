import { TERMS_VERSION } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api';
import { hasRole, useMe } from '../auth';
import { setBadge } from '../badge';
import { t } from '../i18n';
import { nextStep } from '../nextStep';
import { LegalLinks } from '../pages/Legal';
import { resyncPush } from '../push';
import { ErrorText } from './ErrorText';
import { InstallHint } from './InstallHint';

/** Small line icons for the tab bar (24×24, drawn with the text color). */
const ICONS = {
  battles: 'M7 17 17 7M14 7h3v3M7 7l4 4M13 13l4 4M17 14v3h-3',
  open: 'M4 6h16v12H4zM4 7l8 6 8-6',
  new: 'M12 5v14M5 12h14',
  rankings: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * Frame for logged-in pages: a slim header with the profile button and, on top of the screen
 * bottom, a tab bar within thumb reach. Redirects to login if needed.
 */
export function Layout() {
  const { data: user, isLoading } = useMe();
  const active = user?.status === 'active';
  // Shared with the battle list (same query key): a dot when something waits for me.
  const battles = useQuery({
    queryKey: ['myBattles'],
    queryFn: api.myBattles,
    enabled: active,
    refetchInterval: 60_000,
  });
  const pending = usePendingCount(active && hasRole(user, 'athlete', 'federation', 'admin'));
  const reports = useOpenReportCount(active && hasRole(user, 'federation', 'admin'));
  const reviews = useOpenReviews();
  const { pathname } = useLocation();
  // The number on the app icon: battles that wait for me or have new messages, and reviews.
  const waitingCount =
    user && battles.data
      ? reviews.length +
        battles.data.battles.filter(
          (b) => b.unreadMessages > 0 || nextStep(b, b.todo, user.id)?.urgent,
        ).length
      : null;
  useEffect(() => {
    if (waitingCount !== null) void setBadge(waitingCount);
  }, [waitingCount]);
  useEffect(() => {
    if (active) resyncPush().catch(() => {});
  }, [active]);
  // Running battles are loaded once in the background, so they can be opened (and recorded for)
  // without a connection later, even if they were not opened before (offline copies, api.ts).
  const queryClient = useQueryClient();
  const runningIds = (battles.data?.battles ?? [])
    .filter((b) => b.status === 'active')
    .slice(0, 10)
    .map((b) => b.id)
    .join(',');
  useEffect(() => {
    if (!runningIds || navigator.onLine === false) return;
    for (const id of runningIds.split(','))
      void queryClient.prefetchQuery({
        queryKey: ['battle', id],
        queryFn: () => api.battle(id),
        staleTime: 10 * 60_000,
      });
  }, [runningIds, queryClient]);
  if (isLoading) return <main className="muted">{t('common.loading')}</main>;
  if (!user) return <Navigate to="/login" replace />;

  const waiting = (waitingCount ?? 0) > 0;
  return (
    <>
      <header className="header">
        <Link to="/" className="brand">
          {t('appName')}
        </Link>
        <Link to="/profile" className="avatar" aria-label={t('nav.profile')}>
          {user.displayName.slice(0, 1).toUpperCase()}
          {pending + reports > 0 && (
            <span
              className="avatar-badge"
              role="img"
              aria-label={[
                pending > 0 && t('approvals.waiting', { n: pending }),
                reports > 0 && t('reports.waiting', { n: reports }),
              ]
                .filter(Boolean)
                .join(', ')}
            >
              {pending + reports}
            </span>
          )}
        </Link>
      </header>
      <main className="with-tabs">
        <InstallHint />
        {/* The profile stays reachable, so someone who does not agree can delete the account. */}
        {user.termsVersion === TERMS_VERSION || pathname === '/profile' ? (
          <Outlet />
        ) : (
          <TermsGate changed={user.termsVersion !== null} />
        )}
      </main>
      {active && (
        <nav className="tabs">
          <NavLink to="/" end>
            <Icon path={ICONS.battles} />
            {t('nav.battles')}
            {waiting && <span className="dot" role="img" aria-label={t('battles.actionNeeded')} />}
          </NavLink>
          <NavLink to="/open">
            <Icon path={ICONS.open} />
            {t('nav.open')}
          </NavLink>
          <NavLink to="/new">
            <Icon path={ICONS.new} />
            {t('nav.new')}
          </NavLink>
          <NavLink to="/rankings">
            <Icon path={ICONS.rankings} />
            {t('nav.rankings')}
          </NavLink>
        </nav>
      )}
    </>
  );
}

/** Frame for the login and sign-up pages. */
export function PublicLayout() {
  const { data: user } = useMe();
  if (user) return <Navigate to="/" replace />;
  return (
    <main>
      <h1 style={{ textAlign: 'center', marginTop: '2rem' }}>{t('appName')}</h1>
      <Outlet />
      <LegalLinks />
    </main>
  );
}

/** Asks to accept the current terms of use before anything else (new or changed terms). */
function TermsGate({ changed }: { changed: boolean }) {
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api.acceptTerms(TERMS_VERSION),
    onSuccess: (res) => queryClient.setQueryData(['me'], res.user),
  });
  return (
    <div className="card">
      <h1>{t('terms.gateTitle')}</h1>
      <p>{t(changed ? 'terms.gateChanged' : 'terms.gateNew')}</p>
      <LegalLinks />
      <ErrorText error={accept.error} />
      <button type="button" disabled={accept.isPending} onClick={() => accept.mutate()}>
        {t('terms.accept')}
      </button>
      <p className="muted">
        <Link to="/profile">{t('terms.decline')}</Link>
      </p>
    </div>
  );
}

/** How many new members wait for approval (for people who can approve). */
export function usePendingCount(enabled: boolean): number {
  const pending = useQuery({
    queryKey: ['pendingUsers'],
    queryFn: api.pendingUsers,
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  return enabled ? (pending.data?.users.length ?? 0) : 0;
}

/** How many reports are open (for the federation and admins). */
export function useOpenReportCount(enabled: boolean): number {
  const open = useQuery({
    queryKey: ['openReportCount'],
    queryFn: api.openReportCount,
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  return enabled ? (open.data?.count ?? 0) : 0;
}

/** Battles of others waiting for my review (pool or judge). */
export function useOpenReviews() {
  const { data: me } = useMe();
  const query = useQuery({
    queryKey: ['openReviews'],
    queryFn: api.openReviews,
    enabled: me?.status === 'active',
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return query.data?.reviews ?? [];
}
