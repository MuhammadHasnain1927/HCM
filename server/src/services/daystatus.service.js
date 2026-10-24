import { Employee } from '../models/Employee.js';
import { Attendance } from '../models/Attendance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { between, gte, lte, inList } from '../utils/query.js';
import { eachDay, isWorkingDay, maxDate, minDate } from '../utils/time.js';
import { loadCalendar } from './calendar.service.js';

/**
 * The single source of truth for "what happened on this day for this employee".
 * Attendance calendars, the daily board, dashboards, payroll and the AI
 * assistant all use it, so their numbers always agree (brief, Section 6).
 *
 * Day statuses:
 *   present | late | half_day       from the attendance record
 *   missing_checkout                 checked in, never checked out (past day)
 *   on_leave                         approved leave, no record
 *   absent                           working day, no record, no approved leave
 *   not_checked_in                   today, no record yet (not counted yet)
 *   weekend | holiday | upcoming | not_employed   not counted
 */

export const PRESENT_LIKE = ['present', 'late', 'half_day', 'missing_checkout'];

/** Employees who were employed at some point in [from, to]. */
export function employedInRangeFilter(from, to, extra = {}) {
  return {
    ...extra,
    joinDate: lte(to),
    $or: [{ exitDate: null }, { exitDate: gte(from) }],
  };
}

export async function loadDayData({ from, to, employeeIds, departmentId } = {}) {
  const calendar = await loadCalendar({ from, to });
  const empFilter = employedInRangeFilter(from, to, {
    ...(employeeIds ? { _id: inList(employeeIds) } : {}),
    ...(departmentId ? { department: departmentId } : {}),
  });
  const employees = await Employee.find(empFilter)
    .select('code name email department designation joinDate exitDate status gender salary user')
    .populate([
      { path: 'department', select: 'name' },
      { path: 'designation', select: 'title' },
    ])
    .lean();
  const ids = employees.map((e) => e._id);

  const [records, leaves] = await Promise.all([
    Attendance.find({ employee: inList(ids), date: between(from, to) }).lean(),
    LeaveRequest.find({
      employee: inList(ids),
      status: 'approved',
      startDate: lte(to),
      endDate: gte(from),
    })
      .populate('leaveType', 'name code isPaid')
      .lean(),
  ]);

  const recordByKey = new Map(records.map((r) => [`${r.employee}|${r.date}`, r]));
  const leaveByKey = new Map();
  for (const l of leaves) {
    for (const d of eachDay(maxDate(l.startDate, from), minDate(l.endDate, to))) {
      leaveByKey.set(`${l.employee}|${d}`, l);
    }
  }
  return { calendar, employees, from, to, recordByKey, leaveByKey };
}

/** Status of one employee on one day. */
export function dayStatus(employee, date, { calendar, recordByKey, leaveByKey }) {
  const key = `${employee._id}|${date}`;
  const record = recordByKey.get(key) ?? null;
  const leave = leaveByKey.get(key) ?? null;
  const base = { date, record, leave, holidayName: calendar.holidayNames.get(date) ?? null };

  if (date < employee.joinDate || (employee.exitDate && date > employee.exitDate)) {
    return { ...base, status: 'not_employed', counted: false };
  }
  if (date > calendar.today) return { ...base, status: 'upcoming', counted: false };

  const working = isWorkingDay(date, calendar);
  if (record) {
    let status = record.status;
    if (!record.checkOut && date < calendar.today) status = 'missing_checkout';
    return { ...base, status, inProgress: !record.checkOut && date === calendar.today, counted: working };
  }
  if (!working) return { ...base, status: calendar.holidays.has(date) ? 'holiday' : 'weekend', counted: false };
  if (leave) return { ...base, status: 'on_leave', counted: true };
  if (date === calendar.today) return { ...base, status: 'not_checked_in', counted: false };
  return { ...base, status: 'absent', counted: true };
}

/** Every day in the range for one employee. */
export function employeeDays(employee, data) {
  return eachDay(data.from, data.to).map((d) => dayStatus(employee, d, data));
}

export function emptyCounts() {
  // lateArrivals counts check-ins after the grace period, even when the day later
  // became a half day or a missing checkout (used for late-comer lists).
  return { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0, expected: 0, lateArrivals: 0 };
}

/** Adds one day to running counts (only days that count as expected working days). */
export function countDay(counts, day) {
  if (!day.counted) return counts;
  counts.expected += 1;
  if (counts[day.status] !== undefined && day.status !== 'lateArrivals') counts[day.status] += 1;
  if (day.record?.lateMinutes > 0) counts.lateArrivals += 1;
  return counts;
}

/**
 * Metrics from the brief (Section 7):
 *   attendance rate = (present + late + missing_checkout + 0.5 x half_day) / (working-day records - on_leave)
 *   late %          = late / (present + late)
 *   absenteeism     = absent days / expected working days
 */
export function rates(c) {
  const attended = c.present + c.late + c.missing_checkout + 0.5 * c.half_day;
  const denominator = c.expected - c.on_leave;
  return {
    attendanceRate: denominator > 0 ? round1((attended / denominator) * 100) : null,
    latePercent: c.present + c.late > 0 ? round1((c.late / (c.present + c.late)) * 100) : null,
    absenteeism: c.expected > 0 ? round1((c.absent / c.expected) * 100) : null,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
