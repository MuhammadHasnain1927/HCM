import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import ForbiddenPage from '../pages/ForbiddenPage.jsx';

/** Signed-in users only; sends anyone with a temporary password to change it first. */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

/** Only the listed roles. The server checks this too; this just shows a clear page. */
export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <ForbiddenPage />;
  return <Outlet />;
}

/** Pages for signed-out users (login). Signed-in users go to the dashboard. */
export function GuestOnly() {
  const { user } = useAuth();
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;
  return <Outlet />;
}
