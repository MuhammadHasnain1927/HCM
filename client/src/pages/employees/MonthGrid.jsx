import { DAY_STATUS, formatDay, formatMinutes } from '../../lib/format.js';

/**
 * Month calendar grid (Mon-Sun) for attendance days.
 *
 * Props:
 *   days         array from GET /attendance/calendar -> `days`
 *                ([{ date, status, inProgress, holidayName, leaveType, record }])
 *   onSelectDay  optional (day) => void; makes cells clickable buttons
 *   compact      smaller cells, no time line (for summary cards)
 *   showLegend   default true; legend lists only statuses present in `days`
 */

export const STATUS_CELL = {
  present: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
  late: 'bg-amber-100 text-amber-900 ring-amber-200',
  half_day: 'bg-sky-100 text-sky-900 ring-sky-200',
  missing_checkout: 'bg-orange-100 text-orange-900 ring-orange-200',
  absent: 'bg-red-100 text-red-900 ring-red-200',
  on_leave: 'bg-brand-100 text-brand-900 ring-brand-200',
  not_checked_in: 'bg-slate-100 text-slate-700 ring-slate-200',
  weekend: 'bg-slate-50 text-slate-400 ring-slate-100',
  holiday: 'bg-violet-50 text-violet-800 ring-violet-200',
  upcoming: 'bg-white text-slate-400 ring-slate-100',
  not_employed: 'bg-white text-slate-300 ring-slate-100',
};

const DOT = {
  present: 'bg-emerald-500',
  late: 'bg-amber-500',
  half_day: 'bg-sky-500',
  missing_checkout: 'bg-orange-500',
  absent: 'bg-red-500',
  on_leave: 'bg-brand-600',
  not_checked_in: 'bg-slate-400',
  weekend: 'bg-slate-300',
  holiday: 'bg-violet-500',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayTitle(day) {
  const parts = [formatDay(day.date), DAY_STATUS[day.status]?.label || ''];
  if (day.holidayName) parts.push(day.holidayName);
  if (day.leaveType) parts.push(day.leaveType);
  if (day.record) {
    parts.push(`In ${day.record.checkInTime}${day.record.checkOutTime ? `, out ${day.record.checkOutTime}` : ''}`);
    if (day.record.workedMinutes) parts.push(`Worked ${formatMinutes(day.record.workedMinutes)}`);
  }
  if (day.inProgress) parts.push('Still checked in');
  return parts.filter(Boolean).join(' · ');
}

export default function MonthGrid({ days = [], onSelectDay, compact = false, showLegend = true }) {
  if (!days.length) return null;
  // Monday-first offset of the first day (0 = Monday).
  const firstDow = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const offset = (firstDow + 6) % 7;
  const cells = [...Array(offset).fill(null), ...days];
  const present = [...new Set(days.map((d) => d.status))].filter((s) => DOT[s]);

  return (
    <div>
      <div className={`grid grid-cols-7 ${compact ? 'gap-1' : 'gap-1.5'}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {compact ? w[0] : w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} aria-hidden />;
          const n = Number(day.date.slice(8));
          const cls = `${STATUS_CELL[day.status] ?? STATUS_CELL.upcoming} ring-1 ring-inset rounded-lg ${
            compact ? 'h-8 text-xs' : 'min-h-14 p-1.5 text-xs sm:min-h-16'
          } flex flex-col ${compact ? 'items-center justify-center' : 'items-start'} transition`;
          const content = (
            <>
              <span className={`font-semibold ${compact ? '' : 'text-sm'}`}>{n}</span>
              {!compact && day.record?.checkInTime && (
                <span className="mt-auto hidden truncate text-[10px] opacity-80 sm:block">
                  {day.record.checkInTime}
                  {day.record.checkOutTime ? `–${day.record.checkOutTime}` : day.inProgress ? '…' : ''}
                </span>
              )}
              {!compact && !day.record && (day.holidayName || day.leaveType) && (
                <span className="mt-auto hidden w-full truncate text-[10px] opacity-80 sm:block">{day.holidayName || day.leaveType}</span>
              )}
            </>
          );
          return onSelectDay ? (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDay(day)}
              title={dayTitle(day)}
              aria-label={dayTitle(day)}
              className={`${cls} hover:ring-2 hover:ring-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
            >
              {content}
            </button>
          ) : (
            <div key={day.date} title={dayTitle(day)} aria-label={dayTitle(day)} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
      {showLegend && present.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600" aria-label="Legend">
          {present.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${DOT[s]}`} aria-hidden />
              {DAY_STATUS[s]?.label || s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
