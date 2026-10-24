import { Link } from 'react-router';
import { ArrowRight, Building2, CalendarDays, MapPin, UserCog, UserPlus, Users, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Card } from '../components/ui.jsx';
import { ROLE_LABELS } from '../config/navigation.js';

// Getting-started steps per role. The system starts empty (no dummy data),
// so the dashboard guides each role to the actions that create real data.
const NEXT_STEPS = {
  admin: [
    { icon: MapPin, title: 'Set office hours and location', text: 'Start time, grace period, weekend and the check-in radius.', to: '/organization' },
    { icon: Building2, title: 'Add departments and designations', text: 'Employees are registered into these.', to: '/organization?tab=departments' },
    { icon: CalendarDays, title: 'Review leave types and holidays', text: 'Annual 14, sick 8, casual 10 by default.', to: '/organization?tab=leave-types' },
    { icon: UserCog, title: 'Create an HR login', text: 'HR registers employees and runs daily operations.', to: '/users' },
  ],
  hr: [
    { icon: UserPlus, title: 'Register employees', text: 'Each one gets a login with a temporary password.', to: '/employees' },
    { icon: Users, title: 'Watch the attendance board', text: 'See who checked in, who is late and who is on leave.', to: '/attendance' },
    { icon: CalendarDays, title: 'Approve leave requests', text: 'Approve or reject with a comment.', to: '/leave' },
    { icon: Wallet, title: 'Prepare the monthly payroll', text: 'Create a draft for Admin to finalize.', to: '/payroll' },
  ],
  employee: [
    { icon: CalendarDays, title: 'Check in for today', text: 'Your check-in time is recorded by the server.', to: '/attendance' },
    { icon: CalendarDays, title: 'Apply for leave', text: 'See your balance and request time off.', to: '/leave' },
  ],
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { user, company } = useAuth();
  const steps = NEXT_STEPS[user.role] ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="text-sm font-medium text-brand-700">{ROLE_LABELS[user.role]} dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {greeting()}, {user.name.split(' ')[0]}
        </h1>
        {company?.name && <p className="mt-1 text-sm text-slate-500">{company.name}</p>}
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Get started</h2>
        <p className="mt-1 text-sm text-slate-500">
          Numbers appear here once people start using the system. Nothing is pre-loaded.
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {steps.map(({ icon: Icon, title, text, to }) => (
            <li key={title}>
              <Link
                to={to}
                className="group flex h-full items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-brand-200 hover:bg-brand-50/50"
              >
                <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{title}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">{text}</span>
                </span>
                <ArrowRight className="mt-1 size-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
