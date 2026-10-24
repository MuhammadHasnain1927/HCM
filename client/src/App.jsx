import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { WifiOff } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { RequireAuth, RequireRole, GuestOnly } from './components/guards.jsx';
import AppLayout from './components/AppLayout.jsx';
import { Button, EmptyState, FullPageLoader, Spinner } from './components/ui.jsx';
import SetupPage from './pages/SetupPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

// Pages load on demand so the first screen stays small.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const EmployeesPage = lazy(() => import('./pages/employees/EmployeesPage.jsx'));
const Employee360Page = lazy(() => import('./pages/employees/Employee360Page.jsx'));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage.jsx'));
const LeavePage = lazy(() => import('./pages/leave/LeavePage.jsx'));
const PayrollPage = lazy(() => import('./pages/payroll/PayrollPage.jsx'));
const PayrollRunPage = lazy(() => import('./pages/payroll/PayrollRunPage.jsx'));
const PayslipsPage = lazy(() => import('./pages/payroll/PayslipsPage.jsx'));
const OrganizationPage = lazy(() => import('./pages/organization/OrganizationPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage.jsx'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));

const ALL = ['admin', 'hr', 'employee'];
const MANAGERS = ['admin', 'hr'];

function PageLoader() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
      <Spinner /> Loading...
    </div>
  );
}

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
        <Route
          element={
            <Suspense fallback={<FullPageLoader />}>
              <AppLayout />
            </Suspense>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<PageLoader />}>
                <DashboardPage />
              </Suspense>
            }
          />

          <Route element={<RequireRole roles={ALL} />}>
            <Route path="attendance" element={<Lazy page={AttendancePage} />} />
            <Route path="leave" element={<Lazy page={LeavePage} />} />
            <Route path="announcements" element={<Lazy page={AnnouncementsPage} />} />
            <Route path="profile" element={<Lazy page={ProfilePage} />} />
          </Route>

          <Route element={<RequireRole roles={MANAGERS} />}>
            <Route path="employees" element={<Lazy page={EmployeesPage} />} />
            <Route path="employees/:id" element={<Lazy page={Employee360Page} />} />
            <Route path="payroll" element={<Lazy page={PayrollPage} />} />
            <Route path="payroll/:id" element={<Lazy page={PayrollRunPage} />} />
            <Route path="organization" element={<Lazy page={OrganizationPage} />} />
          </Route>

          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="users" element={<Lazy page={UsersPage} />} />
            <Route path="audit-log" element={<Lazy page={AuditLogPage} />} />
          </Route>

          <Route element={<RequireRole roles={['employee', 'hr']} />}>
            <Route path="payslips" element={<Lazy page={PayslipsPage} />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

function Lazy({ page: Page }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  );
}
