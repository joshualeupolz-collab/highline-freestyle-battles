import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout, PublicLayout } from './components/Layout';
import { AdminPage } from './pages/Admin';
import { ApprovalsPage } from './pages/Approvals';
import { BattleDetailPage } from './pages/BattleDetail';
import { BattlesPage } from './pages/Battles';
import { LoginPage } from './pages/Login';
import { NewBattlePage } from './pages/NewBattle';
import { OpenRequestsPage } from './pages/OpenRequests';
import { ProfilePage } from './pages/Profile';
import { ProposeFormatPage } from './pages/ProposeFormat';
import { RankingsPage } from './pages/Rankings';
import { RegisterPage } from './pages/Register';
import { ResetPasswordPage } from './pages/ResetPassword';
import { UserProfilePage } from './pages/UserProfile';
import { VideoLabPage } from './pages/VideoLab';
import './styles.css';

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
  // Video prototype for testers, no login needed (docs/video-prototype.md).
  { path: '/lab/video', element: <VideoLabPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <BattlesPage /> },
      { path: '/open', element: <OpenRequestsPage /> },
      { path: '/new', element: <NewBattlePage /> },
      { path: '/formats/propose', element: <ProposeFormatPage /> },
      { path: '/rankings', element: <RankingsPage /> },
      { path: '/users/:id', element: <UserProfilePage /> },
      { path: '/battles/:id', element: <BattleDetailPage /> },
      { path: '/approvals', element: <ApprovalsPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ],
  },
]);

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
