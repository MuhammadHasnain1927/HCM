// Shared display helpers so every page shows dates, money and statuses the same way.

/** "2026-03-09" -> "Mon, 9 Mar 2026" (calendar days, no timezone shift). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Built by hand: Intl output for en-GB changes punctuation depending on the options.
export function formatDay(iso, { weekday = true, year = true } = {}) {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
  return weekday ? `${WEEKDAYS[d.getUTCDay()]}, ${parts}` : parts;
}

export function formatRange(start, end) {
  if (!start) return '-';
  if (start === end) return formatDay(start);
  return `${formatDay(start, { year: start.slice(0, 4) !== end.slice(0, 4) })} - ${formatDay(end)}`;
}

/** "2026-03" -> "March 2026". */
export function formatMonth(month) {
  if (!month) return '-';
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(value) {
  if (!value) return '';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return formatDateTime(value);
}

export function formatMoney(n, currency = 'PKR') {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatMinutes(min) {
  if (min === null || min === undefined) return '-';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export const formatPercent = (n) => (n === null || n === undefined ? '-' : `${n}%`);

/** Today in the browser as YYYY-MM-DD (UI defaults only; the server decides real "today"). */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const currentMonth = () => todayIso().slice(0, 7);

/** Day status -> label and Badge color (see server daystatus.service.js). */
export const DAY_STATUS = {
  present: { label: 'Present', color: 'green' },
  late: { label: 'Late', color: 'amber' },
  half_day: { label: 'Half day', color: 'blue' },
  missing_checkout: { label: 'Missing check-out', color: 'amber' },
  absent: { label: 'Absent', color: 'red' },
  on_leave: { label: 'On leave', color: 'brand' },
  not_checked_in: { label: 'Not checked in', color: 'gray' },
  weekend: { label: 'Weekend', color: 'gray' },
  holiday: { label: 'Holiday', color: 'brand' },
  upcoming: { label: '', color: 'gray' },
  not_employed: { label: '', color: 'gray' },
};

/** Request status (leave, corrections, payroll) -> Badge color. */
export const REQUEST_STATUS = {
  pending: { label: 'Pending', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  rejected: { label: 'Rejected', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'gray' },
  draft: { label: 'Draft', color: 'amber' },
  finalized: { label: 'Finalized', color: 'green' },
};

export const EMPLOYEE_STATUS = {
  active: { label: 'Active', color: 'green' },
  probation: { label: 'Probation', color: 'blue' },
  exited: { label: 'Exited', color: 'gray' },
};
