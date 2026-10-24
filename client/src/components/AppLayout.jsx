import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { navFor, ROLE_LABELS } from '../config/navigation.js';
import { Logo } from './ui.jsx';
import NotificationsBell from './NotificationsBell.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import AiChatPanel from './AiChatPanel.jsx';

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

const COLLAPSE_KEY = 'hcm.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Dark side menu with grouped links, the company name and the signed-in user.
 * On desktop it can collapse to icons; on phones it opens as a drawer.
 */
function Sidebar({ onNavigate, collapsed = false, onToggleCollapse }) {
  const { user, company, logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#0b1a45_0%,#14154a_60%,#1c1250_100%)] text-blue-50">
      <div className={`flex items-center gap-3 px-4 pb-4 pt-5 ${collapsed ? 'justify-center' : ''}`}>
        <img src="/favicon.svg" alt="" className="size-10 shrink-0 rounded-xl bg-white p-1" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight tracking-tight text-white">
              HCM <span className="bg-[linear-gradient(90deg,#34d399,#60a5fa,#c084fc)] bg-clip-text text-transparent">Lite</span>
            </p>
            {company?.name && <p className="truncate text-xs text-blue-100/60">{company.name}</p>}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Main">
        {navFor(user.role).map(({ group, items }) => (
          <div key={group}>
            {collapsed ? (
              <div className="mx-3 mb-2 border-t border-white/10" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-blue-100/45">{group}</p>
            )}
            <div className="space-y-0.5">
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    [
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                      collapsed ? 'justify-center' : '',
                      isActive ? 'bg-white/12 text-white' : 'text-blue-50/70 hover:bg-white/6 hover:text-white',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-sky-300" aria-hidden />}
                      <Icon className={`size-4.5 shrink-0 ${isActive ? 'text-sky-300' : ''}`} aria-hidden />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className={`flex items-center gap-3 rounded-lg p-2 ${collapsed ? 'flex-col' : ''}`}>
          <Link to="/profile" onClick={onNavigate} title="My profile" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#34d399,#2f80ff,#a855f7)] text-sm font-semibold text-white">
            {initials(user.name)}
          </Link>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="truncate text-xs text-blue-100/60">{ROLE_LABELS[user.role]}</p>
            </div>
          )}
          <button onClick={logout} className="rounded-lg p-2 text-blue-50/70 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4.5" />
          </button>
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs text-blue-100/60 hover:bg-white/6 hover:text-white"
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapse = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* private mode: keep it for this visit only */
      }
      return !c;
    });
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`hidden shrink-0 transition-[width] duration-200 lg:block ${collapsed ? 'w-20' : 'w-64'}`}>
        <div className="sticky top-0 h-screen">
          <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-lg p-2 text-blue-50/70 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <NotificationsBell />
            <Link to="/profile" className="ml-1 flex items-center gap-3 rounded-lg p-1 hover:bg-slate-100" title="My profile">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
              </div>
              <div className="flex size-9 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white" aria-hidden>
                {initials(user.name)}
              </div>
            </Link>
            <button
              onClick={logout}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <AiChatPanel />
    </div>
  );
}
