import { Logo } from './ui.jsx';

/** Centered card layout for setup, login and change-password screens. */
export default function AuthShell({ title, subtitle, children, wide = false }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <Logo className="mb-8" />
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8`}>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-8 text-xs text-slate-400">HCM Lite · AI-assisted Human Capital Management</p>
    </div>
  );
}
