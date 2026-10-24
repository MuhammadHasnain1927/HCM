import { Settings } from '../models/Settings.js';
import { Holiday } from '../models/Holiday.js';
import { notFound } from '../utils/AppError.js';
import { localDate } from '../utils/time.js';
import { between } from '../utils/query.js';
import { now } from '../utils/clock.js';

/**
 * Company calendar used by attendance, leave, payroll and analytics:
 * settings, weekend days, today's date in the company timezone and the
 * public holidays (optionally limited to a date range).
 */
export async function loadCalendar({ from, to } = {}) {
  const settings = await Settings.get().lean();
  if (!settings) throw notFound('Company settings not found. Complete first-run setup.');
  const holidayRows = await Holiday.find(from && to ? { date: between(from, to) } : {}).lean();
  return {
    settings,
    timezone: settings.timezone,
    weekendDays: settings.weekendDays,
    holidays: new Set(holidayRows.map((h) => h.date)),
    holidayNames: new Map(holidayRows.map((h) => [h.date, h.name])),
    today: localDate(now(), settings.timezone),
  };
}
