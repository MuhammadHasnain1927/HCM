import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABELS } from '../config/navigation.js';
import AdminDashboard from './dashboard/AdminDashboard.jsx';
import HrDashboard from './dashboard/HrDashboard.jsx';
import EmployeeDashboard from './dashboard/EmployeeDashboard.jsx';
import CheckInWidget from '../components/attendance/CheckInWidget.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Each role gets its own dashboard (brief #18). */
export default function DashboardPage() {
  const { user, company } = useAuth();
  const header = (
    <div className="mb-5">
      <p className="text-sm font-medium text-brand-700">{ROLE_LABELS[user.role]} dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
        {greeting()}, {user.name.split(' ')[0]}
      </h1>
      {company?.name && <p className="mt-1 text-sm text-slate-500">{company.name}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      {user.role === 'admin' && <AdminDashboard header={header} />}
      {user.role === 'hr' && (
        <HrDashboard
          scope="hr"
          header={
            <>
              {header}
              {/* HR also checks in (brief #09) when linked to an employee record. */}
              {user.employeeId && (
                <div className="mb-5">
                  <CheckInWidget />
                </div>
              )}
            </>
          }
        />
      )}
      {user.role === 'employee' && <EmployeeDashboard header={header} />}
    </div>
  );
}
