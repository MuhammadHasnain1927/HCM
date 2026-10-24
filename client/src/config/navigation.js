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

// Menu per role (brief, Section 2 and Section 8). The server enforces the same
// rules; this only decides what each role sees.
export const NAVIGATION = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'hr', 'employee'], end: true },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'hr'] },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['admin', 'hr', 'employee'] },
  { to: '/leave', label: 'Leave', icon: CalendarDays, roles: ['admin', 'hr', 'employee'] },
  { to: '/payroll', label: 'Payroll', icon: Wallet, roles: ['admin', 'hr'] },
  { to: '/payslips', label: 'My payslips', icon: FileText, roles: ['employee'] },
  { to: '/announcements', label: 'Announcements', icon: Megaphone, roles: ['admin', 'hr', 'employee'] },
  { to: '/organization', label: 'Organization', icon: Settings, roles: ['admin', 'hr'] },
  { to: '/users', label: 'User accounts', icon: UserCog, roles: ['admin'] },
  { to: '/audit-log', label: 'Audit log', icon: ClipboardList, roles: ['admin'] },
  { to: '/profile', label: 'My profile', icon: UserCircle, roles: ['hr', 'employee'] },
];

export const navFor = (role) => NAVIGATION.filter((item) => item.roles.includes(role));
