import {
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Megaphone,
  Settings,
  UserCircle,
  Users,
  UserCog,
  Wallet,
} from 'lucide-react';

export const ROLE_LABELS = { admin: 'Admin', hr: 'HR', employee: 'Employee' };

// Menu per role, in groups (brief, Section 2 and Section 8). The server
// enforces the same rules; this only decides what each role sees.
export const NAVIGATION = [
  {
    group: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'hr', 'employee'], end: true }],
  },
  {
    group: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'hr'] },
      { to: '/users', label: 'User accounts', icon: UserCog, roles: ['admin'] },
    ],
  },
  {
    group: 'Time',
    items: [
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['admin', 'hr', 'employee'] },
      { to: '/leave', label: 'Leave', icon: CalendarDays, roles: ['admin', 'hr', 'employee'] },
    ],
  },
  {
    group: 'Pay',
    items: [
      { to: '/payroll', label: 'Payroll', icon: Wallet, roles: ['admin', 'hr'] },
      { to: '/payslips', label: 'My payslips', icon: FileText, roles: ['hr', 'employee'] },
    ],
  },
  {
    group: 'Company',
    items: [
      { to: '/announcements', label: 'Announcements', icon: Megaphone, roles: ['admin', 'hr', 'employee'] },
      { to: '/organization', label: 'Organization', icon: Settings, roles: ['admin', 'hr'] },
      { to: '/audit-log', label: 'Audit log', icon: ClipboardList, roles: ['admin'] },
    ],
  },
  {
    group: 'Account',
    items: [{ to: '/profile', label: 'My profile', icon: UserCircle, roles: ['admin', 'hr', 'employee'] }],
  },
];

/** Groups with only the items this role may see (empty groups dropped). */
export const navFor = (role) =>
  NAVIGATION.map((g) => ({ ...g, items: g.items.filter((item) => item.roles.includes(role)) })).filter((g) => g.items.length);
