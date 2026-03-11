import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const requires2FASetup = useAuthStore((s) => s.requires2FASetup);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Admin sem 2FA: forcar setup (permitir apenas /setup-2fa e /profile)
  if (requires2FASetup && location.pathname !== '/setup-2fa' && location.pathname !== '/profile') {
    return <Navigate to="/setup-2fa" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
