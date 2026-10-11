import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { hasRole, useMe } from '../auth';
import { t } from '../i18n';

/** Frame for logged-in pages: header with navigation. Redirects to login if needed. */
export function Layout() {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <main className="muted">{t('common.loading')}</main>;
  if (!user) return <Navigate to="/login" replace />;

  const active = user.status === 'active';
  return (
    <>
      <header className="header">
        <Link to="/" className="brand">
          {t('appName')}
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            {t('nav.battles')}
          </NavLink>
          {active && <NavLink to="/open">{t('nav.open')}</NavLink>}
          {active && <NavLink to="/new">{t('nav.new')}</NavLink>}
          {active && <NavLink to="/rankings">{t('nav.rankings')}</NavLink>}
          {hasRole(user, 'athlete', 'federation', 'admin') && (
            <NavLink to="/approvals">{t('nav.approvals')}</NavLink>
          )}
          {hasRole(user, 'federation', 'admin') && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
          <NavLink to="/profile">{t('nav.profile')}</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
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
    </main>
  );
}
