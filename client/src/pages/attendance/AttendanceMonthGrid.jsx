import { DAY_STATUS } from '../../lib/format.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Cell colors per day status (kept local to the attendance pages).
const CELL = {
  present: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  late: 'bg-amber-50 text-amber-800 ring-amber-200',
  half_day: 'bg-sky-50 text-sky-800 ring-sky-200',
  missing_checkout: 'bg-orange-50 text-orange-800 ring-orange-200',
  absent: 'bg-red-50 text-red-700 ring-red-200',
  on_leave: 'bg-brand-50 text-brand-800 ring-brand-200',
  holiday: 'bg-violet-50 text-violet-700 ring-violet-200',
  weekend: 'bg-slate-50 text-slate-400 ring-slate-100',
  not_checked_in: 'bg-white text-slate-600 ring-slate-300',
  upcoming: 'bg-white text-slate-300 ring-slate-100',
  not_employed: 'bg-white text-slate-300 ring-slate-100',
};

const LEGEND = ['present', 'late', 'half_day', 'missing_checkout', 'absent', 'on_leave', 'holiday', 'weekend'];

/** Monday-first month grid for one employee's attendance calendar. */
export default function AttendanceMonthGrid({ days, onSelect, selected }) {
  if (!days?.length) return null;
  // Monday = 0 ... Sunday = 6
  const firstDow = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const blanks = Array.from({ length: firstDow });

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:gap-1.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="grid" aria-label="Attendance calendar">
        {blanks.map((_, i) => (
          <div key={`b${i}`} aria-hidden />
        ))}
        {days.map((d) => {
          const meta = DAY_STATUS[d.status];
          const label = d.holidayName ?? d.leaveType ?? meta?.label ?? '';
          const isSelected = selected === d.date;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelect?.(d)}
              title={[d.date, label, d.record?.checkInTime && `In ${d.record.checkInTime}`, d.record?.checkOutTime && `Out ${d.record.checkOutTime}`].filter(Boolean).join(' · ')}
              aria-label={`${d.date}: ${label || 'no status'}`}
              aria-pressed={isSelected}
              className={`flex min-h-12 flex-col items-start rounded-lg px-1.5 py-1 text-left ring-1 transition hover:brightness-95 sm:min-h-16 sm:px-2 ${
                CELL[d.status] ?? CELL.upcoming
              } ${isSelected ? 'outline-2 outline-offset-1 outline-brand-600' : ''}`}
            >
              <span className="text-xs font-semibold sm:text-sm">{Number(d.date.slice(8))}</span>
              {d.record?.checkInTime && <span className="hidden text-[10px] leading-tight opacity-80 sm:block">{d.record.checkInTime}</span>}
              {!d.record && meta?.label && d.status !== 'upcoming' && d.status !== 'weekend' && (
                <span className="hidden truncate text-[10px] leading-tight opacity-80 sm:block">{meta.label}</span>
              )}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-600">
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={`size-3 rounded ring-1 ${CELL[s]}`} aria-hidden />
            {DAY_STATUS[s].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
