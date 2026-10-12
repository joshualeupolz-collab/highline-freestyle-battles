import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout, PublicLayout } from './components/Layout';
import { AdminPage } from './pages/Admin';
import { ApprovalsPage } from './pages/Approvals';
import { BattleDetailPage } from './pages/BattleDetail';
import { BattlesPage } from './pages/Battles';
import { DeletionRequestPage } from './pages/DeletionRequest';
import { LegalPage } from './pages/Legal';
import { LoginPage } from './pages/Login';
import { NewBattlePage } from './pages/NewBattle';
import { OnsiteResultPage } from './pages/OnsiteResult';
import { OpenRequestsPage } from './pages/OpenRequests';
import { ProfilePage } from './pages/Profile';
import { ProposeFormatPage } from './pages/ProposeFormat';
import { RankingsPage } from './pages/Rankings';
import { RegisterPage } from './pages/Register';
import { ReportsPage } from './pages/Reports';
import { ResetPasswordPage } from './pages/ResetPassword';
import { UserProfilePage } from './pages/UserProfile';
import { VideoLabPage } from './pages/VideoLab';
import './styles.css';
import { startUploadQueue } from './video/uploadQueue';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

/** All pages of the app. Adding a page = one line here (plus a link in Layout). */
const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    path: '/reset-password',
    element: (
      <main>
        <ResetPasswordPage />
      </main>
    ),
  },
  // After deleting an account, and the deletion link: no login (concept section 12).
  { path: '/deletion-request', element: <DeletionRequestPage /> },
  // Legal texts: public, linked from sign-up and every profile (concept section 12).
  { path: '/privacy', element: <LegalPage doc="privacy" /> },
  { path: '/terms', element: <LegalPage doc="terms" /> },
  { path: '/imprint', element: <LegalPage doc="imprint" /> },
  // Video prototype for testers, no login needed (docs/video-prototype.md).
  { path: '/lab/video', element: <VideoLabPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <BattlesPage /> },
      { path: '/open', element: <OpenRequestsPage /> },
      { path: '/new', element: <NewBattlePage /> },
      { path: '/onsite', element: <OnsiteResultPage /> },
      { path: '/formats/propose', element: <ProposeFormatPage /> },
      { path: '/rankings', element: <RankingsPage /> },
      { path: '/users/:id', element: <UserProfilePage /> },
      { path: '/battles/:id', element: <BattleDetailPage /> },
      { path: '/approvals', element: <ApprovalsPage /> },
      { path: '/reports', element: <ReportsPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ],
  },
]);

// After a deployment the service worker first serves the cached old app. The new worker takes over
// right after installing (autoUpdate); then reload so nobody keeps running old code, e.g. a page
// the old version does not know yet. Not on the very first visit, when there was no old worker.
if ('serviceWorker' in navigator) {
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) window.location.reload();
  });
}

// Battle videos recorded offline are uploaded whenever the app is open and online.
startUploadQueue();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
