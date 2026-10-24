import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarRange, Megaphone, RefreshCw, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { timeAgo, todayIso } from '../../lib/format.js';
import { Alert, Button, Card, Spinner } from '../ui.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function KpiCard({ label, value, hint, icon: Icon, tone = 'default', to }) {
  const body = (
    <Card className={cx('h-full p-4 transition', to && 'hover:border-brand-200 hover:shadow')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className={cx('size-4', tone === 'warn' ? 'text-amber-600' : 'text-slate-400')} aria-hidden />}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value ?? '-'}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SectionCard({ title, description, action, children, className }) {
  return (
    <Card className={cx('flex flex-col p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

/** One row of filters above the charts: date range + department. */
export function FilterBar({ value, onChange, showDepartment = true }) {
  const departments = useApi(showDepartment ? '/org/departments' : null);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;

  const presets = [
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last 30 days', from: shift(today, -29), to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];

  const apply = (next) => {
    setLocal(next);
    if (next.from && next.to && next.from <= next.to) onChange(next);
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <CalendarRange className="size-4 text-slate-400" aria-hidden /> Filters
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => apply({ ...local, from: p.from, to: p.to })}
            className={cx(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              local.from === p.from && local.to === p.to ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          From
          <input type="date" value={local.from} max={local.to} onChange={(e) => apply({ ...local, from: e.target.value })} className="mt-0.5 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input type="date" value={local.to} min={local.from} max={today} onChange={(e) => apply({ ...local, to: e.target.value })} className="mt-0.5 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
        </label>
        {showDepartment && (
          <label className="text-xs text-slate-500">
            Department
            <select
              value={local.departmentId ?? ''}
              onChange={(e) => apply({ ...local, departmentId: e.target.value || undefined })}
              className="mt-0.5 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
            >
              <option value="">All departments</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function shift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Summarize" sends the current filters; the server computes the KPIs and asks the AI (brief #20). */
export function AiSummaryCard({ scope, filters }) {
  const [state, setState] = useState({ loading: false, bullets: null, error: '' });
  const key = JSON.stringify(filters);
  useEffect(() => setState({ loading: false, bullets: null, error: '' }), [key]);

  const run = async () => {
    setState({ loading: true, bullets: null, error: '' });
    try {
      const { data } = await api.post('/ai/summary', { scope, ...filters });
      setState({ loading: false, bullets: data.bullets, error: '' });
    } catch (err) {
      setState({ loading: false, bullets: null, error: errorMessage(err) });
    }
  };

  return (
    <SectionCard
      title="AI summary"
      description="Insights from the numbers on this dashboard, for the current filters."
      action={
        <Button variant={state.bullets ? 'secondary' : 'primary'} className="px-3 py-1.5" onClick={run} loading={state.loading}>
          {state.bullets ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
          {state.bullets ? 'Refresh' : 'Summarize'}
        </Button>
      }
    >
      {state.error && <Alert type="error">{state.error}</Alert>}
      {state.loading && (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <Spinner className="size-4" /> Reading the dashboard...
        </div>
      )}
      {state.bullets && (
        <>
          <ul className="space-y-2">
            {state.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-medium text-brand-700">AI-generated · check important numbers on the charts</p>
        </>
      )}
      {!state.bullets && !state.loading && !state.error && <p className="text-sm text-slate-500">Click Summarize for 3-5 quick insights.</p>}
    </SectionCard>
  );
}

/** Latest announcements on every dashboard (brief, M9). */
export function AnnouncementsWidget({ limit = 3 }) {
  const { data, loading, error } = useApi('/announcements', { params: { limit } });
  return (
    <SectionCard
      title="Announcements"
      action={
        <Link to="/announcements" className="text-xs font-medium text-brand-700 hover:underline">
          View all
        </Link>
      }
    >
      {loading && !data && <Spinner className="size-4" />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && data.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Megaphone className="size-4 text-slate-400" /> No announcements yet.
        </p>
      )}
      <ul className="space-y-3">
        {(data ?? []).map((a) => (
          <li key={a.id} className="border-l-2 border-brand-200 pl-3">
            <p className="text-sm font-medium text-slate-900">{a.title}</p>
            <p className="line-clamp-2 text-sm text-slate-600">{a.body}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {a.authorName} · {timeAgo(a.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
