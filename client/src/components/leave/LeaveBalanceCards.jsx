import { CalendarDays } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { Alert, Card, Spinner } from '../ui.jsx';

/**
 * Leave balance per type (quota, used, pending, remaining) from GET /leaves/balance.
 * Reused on the Leave page and the Employee dashboard.
 */
export default function LeaveBalanceCards({ employeeId, year, compact = false }) {
  const { data, loading, error, reload } = useApi('/leaves/balance', {
    params: { ...(employeeId ? { employeeId } : {}), ...(year ? { year } : {}) },
  });

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Spinner /> Loading leave balance...
      </div>
    );
  }
  if (error) {
    return (
      <Alert type="error">
        {error}{' '}
        <button className="font-medium underline" onClick={reload}>
          Try again
        </button>
      </Alert>
    );
  }
  const balances = data?.balances ?? [];
  if (!balances.length) {
    return <p className="py-4 text-sm text-slate-500">No leave types are set up yet.</p>;
  }

  return (
    <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
      {balances.map((b) => {
        const unlimited = b.quota === null;
        const usedPct = unlimited || !b.quota ? 0 : Math.min(100, Math.round((b.used / b.quota) * 100));
        const pendingPct = unlimited || !b.quota ? 0 : Math.min(100 - usedPct, Math.round((b.pending / b.quota) * 100));
        return (
          <Card key={b.leaveTypeId} className={compact ? 'p-3' : 'p-4'}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">{b.name}</p>
              {!compact && <CalendarDays className="size-4 shrink-0 text-slate-400" aria-hidden />}
            </div>
            <p className={`mt-1 font-semibold text-slate-900 ${compact ? 'text-xl' : 'text-2xl'}`}>
              {unlimited ? (
                <span className="text-lg">Unlimited</span>
              ) : (
                <>
                  {b.remaining}
                  <span className="text-sm font-normal text-slate-500"> / {b.quota} left</span>
                </>
              )}
            </p>
            {!unlimited && (
              <div
                className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`${b.name}: ${b.used} of ${b.quota} days used`}
                aria-valuenow={b.used}
                aria-valuemin={0}
                aria-valuemax={b.quota}
              >
                <div className="bg-brand-600" style={{ width: `${usedPct}%` }} />
                <div className="bg-amber-400" style={{ width: `${pendingPct}%` }} />
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {b.used} used{b.pending ? ` · ${b.pending} pending` : ''}
              {!b.isPaid ? ' · unpaid' : ''}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
