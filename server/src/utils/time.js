// Calendar helpers. Business rules (late after 09:15, working days, leave days)
// are evaluated in the company timezone, never the server's (hosting runs in UTC).
// Calendar days are plain "YYYY-MM-DD" strings so they never shift between zones.

const partsCache = new Map();

function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(
      tz,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return partsCache.get(tz);
}

function zonedParts(date, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" for the given instant in the company timezone. */
export function localDate(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes since local midnight for the given instant in the company timezone. */
export function localMinutes(date, tz) {
  const p = zonedParts(date, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** "HH:MM" local time. */
export function localTime(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.hour}:${p.minute}`;
}

export const hhmmToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * The UTC instant for a local calendar day and "HH:MM" in a timezone
 * (used when HR approves a correction with times like 09:05).
 */
export function zonedDateTime(isoDate, hhmm, tz) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  // Start from the same wall-clock time in UTC, then correct by the zone offset (twice for DST edges).
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    guess += Date.UTC(y, mo - 1, d, h, mi) - asUtc;
  }
  return new Date(guess);
}

const toUtcDate = (iso) => new Date(`${iso}T00:00:00Z`);
const fromUtcDate = (d) => d.toISOString().slice(0, 10);

export function addDays(iso, n) {
  const d = toUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

/** 0 = Sunday ... 6 = Saturday for a calendar day. */
export const dayOfWeek = (iso) => toUtcDate(iso).getUTCDay();

/** Every calendar day from start to end inclusive. */
export function eachDay(start, end) {
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export const daysBetween = (start, end) => Math.round((toUtcDate(end) - toUtcDate(start)) / 86400000);

/** A working day is not a weekend day and not a public holiday. */
export function isWorkingDay(iso, { weekendDays, holidays }) {
  return !weekendDays.includes(dayOfWeek(iso)) && !holidays.has(iso);
}

export function workingDaysBetween(start, end, calendar) {
  return eachDay(start, end).filter((d) => isWorkingDay(d, calendar));
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

export const maxDate = (a, b) => (a > b ? a : b);
export const minDate = (a, b) => (a < b ? a : b);

/** Monday of the week containing the given day. */
export function startOfWeek(iso) {
  const dow = dayOfWeek(iso);
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
