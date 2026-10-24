import { AlertCircle, Inbox } from 'lucide-react';
import { Button, Spinner } from './ui.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

const BADGE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  brand: 'bg-brand-50 text-brand-800 ring-brand-600/20',
};

export function Badge({ color = 'gray', children }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[color])}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-full gap-1 border-b border-slate-200 sm:min-w-0">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
              value === t.value ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Data table with built-in loading, error and empty states.
 * columns: [{ key, header, render?(row), className? }]
 */
export function DataTable({ columns, rows, loading, error, onRetry, empty, rowKey = (r) => r.id }) {
  if (loading && !rows?.length) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
        <Spinner /> Loading...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center text-sm">
        <AlertCircle className="size-6 text-red-500" />
        <p className="text-slate-600">{error}</p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (!rows?.length) {
    return (
      empty ?? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-slate-500">
          <Inbox className="size-6 text-slate-400" />
          Nothing here yet.
        </div>
      )
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-3 font-medium', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50/60">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-3 align-middle text-slate-700', c.className)}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
