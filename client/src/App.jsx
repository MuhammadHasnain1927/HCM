import { Navigate, Route, Routes } from 'react-router';
import { WifiOff } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { RequireAuth, RequireRole, GuestOnly } from './components/guards.jsx';
import AppLayout from './components/AppLayout.jsx';
import { Button, EmptyState, FullPageLoader } from './components/ui.jsx';
import SetupPage from './pages/SetupPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ComingSoonPage from './pages/ComingSoonPage.jsx';
import OrganizationPage from './pages/organization/OrganizationPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

const ALL = ['admin', 'hr', 'employee'];
const MANAGERS = ['admin', 'hr'];

export default function App() {
  const { loading, bootError, setupDone, retry } = useAuth();

  if (loading) return <FullPageLoader label="Starting HCM Lite..." />;

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <EmptyState icon={WifiOff} title="Can't reach the server" action={<Button onClick={retry}>Try again</Button>}>
          {bootError}
        </EmptyState>
      </div>
    );
  }

  // Fresh install: everything leads to first-run setup.
  if (!setupDone) {
    return (
      <Routes>
        <Route path="*" element={<SetupPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route path="/change-password" element={<ChangePasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />

          <Route element={<RequireRole roles={ALL} />}>
            <Route path="attendance" element={<ComingSoonPage title="Attendance" />} />
            <Route path="leave" element={<ComingSoonPage title="Leave" />} />
            <Route path="announcements" element={<ComingSoonPage title="Announcements" />} />
          </Route>

          <Route element={<RequireRole roles={MANAGERS} />}>
            <Route path="employees" element={<ComingSoonPage title="Employees" />} />
            <Route path="payroll" element={<ComingSoonPage title="Payroll" />} />
            <Route path="organization" element={<OrganizationPage />} />
          </Route>

          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="users" element={<UsersPage />} />
            <Route path="audit-log" element={<ComingSoonPage title="Audit log" />} />
          </Route>

          <Route element={<RequireRole roles={['employee']} />}>
            <Route path="payslips" element={<ComingSoonPage title="My payslips" />} />
            <Route path="profile" element={<ComingSoonPage title="My profile" />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
