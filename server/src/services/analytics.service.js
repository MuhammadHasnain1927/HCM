import mongoose from 'mongoose';
import { Employee, round2, salaryBreakdown } from '../models/Employee.js';
import { Department } from '../models/Department.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveType } from '../models/LeaveType.js';
import { AttendanceCorrection } from '../models/Attendance.js';
import { AuditLog } from '../models/AuditLog.js';
import { PayrollRun, Payslip } from '../models/Payroll.js';
import { forbidden, unprocessable } from '../utils/AppError.js';
import { between, gte, inList, lte } from '../utils/query.js';
import { daysBetween, eachDay, isWorkingDay, startOfWeek } from '../utils/time.js';
import { now } from '../utils/clock.js';
import { isManager } from '../middleware/auth.js';
import { loadCalendar } from './calendar.service.js';
import { countDay, dayStatus, emptyCounts, employeeDays, loadDayData, rates } from './daystatus.service.js';
import { getBalances } from './leave.service.js';
import { listPayslips } from './payroll.service.js';

const MAX_RANGE_DAYS = 366;
// Aggregation pipelines do not cast ids, so string ids are converted here.
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const CURRENT = ['active', 'probation'];

/** Default range is the current month to date; ranges never go past today. */
export async function resolveRange({ from, to } = {}) {
  const cal = await loadCalendar();
  const end = to && to < cal.today ? to : cal.today;
  const start = from ?? `${cal.today.slice(0, 7)}-01`;
  if (start > end) throw unprocessable('The start date must be on or before the end date (and not in the future)', 'INVALID_RANGE');
  if (daysBetween(start, end) > MAX_RANGE_DAYS) throw unprocessable('Pick a range of one year or less', 'INVALID_RANGE');
  return { from: start, to: end, today: cal.today, calendar: cal };
}

const isCurrentOn = (emp, date) => emp.joinDate <= date && (!emp.exitDate || emp.exitDate >= date) && emp.status !== 'exited';

// ---------- Shared building blocks (also used by the AI tools) ----------

export async function headcount({ departmentId } = {}) {
  const cal = await loadCalendar();
  const filter = { status: inList(CURRENT), joinDate: lte(cal.today), ...(departmentId ? { department: departmentId } : {}) };
  const [total, byStatus, byDept] = await Promise.all([
    Employee.countDocuments(filter),
    Employee.aggregate([{ $match: { ...(departmentId ? { department: oid(departmentId) } : {}) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Employee.aggregate([
      { $match: { status: { $in: CURRENT }, joinDate: { $lte: cal.today }, ...(departmentId ? { department: oid(departmentId) } : {}) } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
      { $project: { count: 1, name: { $ifNull: [{ $arrayElemAt: ['$dept.name', 0] }, 'No department'] } } },
      { $sort: { count: -1, name: 1 } },
    ]),
  ]);
  return {
    asOf: cal.today,
    headcount: total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    byDepartment: byDept.map((d) => ({ department: d.name, count: d.count })),
  };
}

/**
 * Attendance over a range: totals, rates, a per-day trend, per-department
 * breakdown and per-employee counts (late-comers, absence).
 */
export async function attendanceSummary({ from, to, departmentId } = {}) {
  const range = await resolveRange({ from, to });
  const data = await loadDayData({ from: range.from, to: range.to, departmentId });
  const totals = emptyCounts();
  const byDept = new Map();
  const byDay = new Map(eachDay(range.from, range.to).map((d) => [d, emptyCounts()]));
  const perEmployee = [];

  for (const emp of data.employees) {
    const counts = emptyCounts();
    for (const day of employeeDays(emp, data)) {
      countDay(counts, day);
      countDay(totals, day);
      countDay(byDay.get(day.date), day);
    }
    const deptName = emp.department?.name ?? 'No department';
    if (!byDept.has(deptName)) byDept.set(deptName, emptyCounts());
    const d = byDept.get(deptName);
    for (const k of Object.keys(counts)) d[k] += counts[k];
    perEmployee.push({ employeeId: String(emp._id), name: emp.name, code: emp.code, department: deptName, ...counts });
  }

  const trend = [...byDay.entries()]
    .filter(([date]) => isWorkingDay(date, data.calendar))
    .map(([date, c]) => ({ date, ...rates(c), present: c.present + c.late + c.missing_checkout, halfDay: c.half_day, late: c.late, absent: c.absent, onLeave: c.on_leave }))
    .filter((t) => t.attendanceRate !== null || t.onLeave > 0);

  return {
    from: range.from,
    to: range.to,
    totals,
    ...rates(totals),
    trend,
    byDepartment: [...byDept.entries()].map(([department, c]) => ({ department, ...c, ...rates(c) })).sort((a, b) => (b.absenteeism ?? 0) - (a.absenteeism ?? 0)),
    perEmployee,
  };
}

export async function lateComers({ from, to, departmentId, limit = 5 } = {}) {
  const s = await attendanceSummary({ from, to, departmentId });
  return {
    from: s.from,
    to: s.to,
    lateComers: s.perEmployee
      .filter((e) => e.lateArrivals > 0)
      .sort((a, b) => b.lateArrivals - a.lateArrivals || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((e) => ({ name: e.name, code: e.code, department: e.department, lateDays: e.lateArrivals })),
  };
}

/** Status of everyone for one day (present / late / on leave / not checked in ...). */
export async function todaySnapshot({ departmentId } = {}) {
  const cal = await loadCalendar();
  const data = await loadDayData({ from: cal.today, to: cal.today, departmentId });
  const snap = { date: cal.today, lateArrivals: 0, present: 0, late: 0, halfDay: 0, onLeave: 0, notCheckedIn: 0, absent: 0, isWorkingDay: isWorkingDay(cal.today, cal) };
  const onLeave = [];
  for (const emp of data.employees) {
    if (!isCurrentOn(emp, cal.today)) continue;
    const d = dayStatus(emp, cal.today, data);
    if (d.record?.lateMinutes > 0) snap.lateArrivals += 1;
    if (d.status === 'present') snap.present += 1;
    else if (d.status === 'late') snap.late += 1;
    else if (d.status === 'half_day') snap.halfDay += 1;
    else if (d.status === 'on_leave') {
      snap.onLeave += 1;
      onLeave.push({ name: emp.name, department: emp.department?.name ?? null, leaveType: d.leave?.leaveType?.name ?? null, until: d.leave?.endDate ?? null });
    } else if (d.status === 'not_checked_in') snap.notCheckedIn += 1;
    else if (d.status === 'absent') snap.absent += 1;
  }
  snap.checkedIn = snap.present + snap.late + snap.halfDay;
  return { ...snap, onLeaveList: onLeave };
}

/** Approved leave days per type inside the range, plus utilization against quotas. */
export async function leaveSummary({ from, to, departmentId } = {}) {
  const range = await resolveRange({ from, to });
  const data = await loadDayData({ from: range.from, to: range.to, departmentId });
  const byType = new Map();
  for (const emp of data.employees) {
    for (const day of employeeDays(emp, data)) {
      if (day.status !== 'on_leave') continue;
      const name = day.leave?.leaveType?.name ?? 'Leave';
      byType.set(name, (byType.get(name) ?? 0) + 1);
    }
  }

  // Utilization for the year of the range end: approved days / (quota x headcount).
  const year = range.to.slice(0, 4);
  const ids = data.employees.map((e) => e._id);
  const [types, yearLeaves, pending] = await Promise.all([
    LeaveType.find({ isActive: true }).lean(),
    LeaveRequest.find({ employee: inList(ids), status: 'approved', startDate: between(`${year}-01-01`, `${year}-12-31`) }).lean(),
    LeaveRequest.countDocuments({ employee: inList(ids), status: 'pending' }),
  ]);
  const people = data.employees.filter((e) => isCurrentOn(e, range.to)).length;
  const utilization = types.map((t) => {
    const used = yearLeaves.filter((l) => String(l.leaveType) === String(t._id)).reduce((s, l) => s + l.days, 0);
    const capacity = t.yearlyQuota === null ? null : t.yearlyQuota * people;
    return { leaveType: t.name, code: t.code, approvedDays: used, quota: t.yearlyQuota, utilization: capacity ? Math.round((used / capacity) * 1000) / 10 : null };
  });

  return {
    from: range.from,
    to: range.to,
    byType: [...byType.entries()].map(([leaveType, days]) => ({ leaveType, days })).sort((a, b) => b.days - a.days),
    utilization,
    pendingRequests: pending,
  };
}

// ---------- Bonus insights: absence anomalies and attrition risk ----------

function insightsFrom(summary, employees, today) {
  const people = summary.perEmployee;
  const avgAbsent = people.length ? people.reduce((s, p) => s + p.absent, 0) / people.length : 0;
  const anomalies = people
    .filter((p) => p.absent >= 3 && p.absent >= 2 * Math.max(avgAbsent, 1))
    .map((p) => ({ name: p.name, department: p.department, absentDays: p.absent, teamAverage: Math.round(avgAbsent * 10) / 10 }));

  const empById = new Map(employees.map((e) => [String(e._id), e]));
  // Scores need at least 5 working days of history to mean anything.
  const risk = people
    .filter((p) => p.expected - p.on_leave >= 5)
    .map((p) => {
      const emp = empById.get(p.employeeId);
      const tenureMonths = emp ? Math.max(0, daysBetween(emp.joinDate, today) / 30.4) : 0;
      const expected = Math.max(p.expected - p.on_leave, 1);
      // Simple explainable score (0-100): absence, lateness and short tenure.
      const score = Math.min(100, Math.round((p.absent / expected) * 60 + (p.lateArrivals / expected) * 25 + (tenureMonths < 6 ? 15 : 0)));
      const reasons = [];
      if (p.absent / expected >= 0.15) reasons.push(`${p.absent} absent days`);
      if (p.lateArrivals / expected >= 0.3) reasons.push(`late on ${p.lateArrivals} days`);
      if (tenureMonths < 6) reasons.push('joined less than 6 months ago');
      return { name: p.name, department: p.department, score, level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', reasons };
    })
    .filter((r) => r.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { absenceAnomalies: anomalies, attritionRisk: risk };
}

// ---------- Dashboards ----------

export async function hrDashboard(user, { from, to, departmentId } = {}) {
  if (!isManager(user)) throw forbidden();
  const [hc, today, summary, leave, pendingLeaves, pendingCorrections] = await Promise.all([
    headcount({ departmentId }),
    todaySnapshot({ departmentId }),
    attendanceSummary({ from, to, departmentId }),
    leaveSummary({ from, to, departmentId }),
    LeaveRequest.countDocuments({ status: 'pending' }),
    AttendanceCorrection.countDocuments({ status: 'pending' }),
  ]);
  const employees = await Employee.find({ _id: inList(summary.perEmployee.map((p) => p.employeeId)) }).select('joinDate').lean();
  const late = summary.perEmployee
    .filter((e) => e.lateArrivals > 0)
    .sort((a, b) => b.lateArrivals - a.lateArrivals || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((e) => ({ name: e.name, department: e.department, lateDays: e.lateArrivals }));

  return {
    filters: { from: summary.from, to: summary.to, departmentId: departmentId ?? null },
    kpis: {
      headcount: hc.headcount,
      presentToday: today.checkedIn,
      onLeaveToday: today.onLeave,
      lateToday: today.lateArrivals,
      notCheckedInToday: today.notCheckedIn,
      pendingApprovals: pendingLeaves + pendingCorrections,
      pendingLeaves,
      pendingCorrections,
      attendanceRate: summary.attendanceRate,
      latePercent: summary.latePercent,
      absenteeism: summary.absenteeism,
    },
    today,
    attendanceTrend: summary.trend,
    absenteeismByDepartment: summary.byDepartment.map((d) => ({ department: d.department, absenteeism: d.absenteeism, attendanceRate: d.attendanceRate, latePercent: d.latePercent, absentDays: d.absent })),
    leaveByType: leave.byType,
    leaveUtilization: leave.utilization,
    topLateComers: late,
    insights: insightsFrom(summary, employees, today.date),
  };
}

export async function adminDashboard(user, { from, to, departmentId } = {}) {
  if (user.role !== 'admin') throw forbidden();
  const range = await resolveRange({ from, to });
  const deptMatch = departmentId ? { department: departmentId } : {};
  const year = range.to.slice(0, 4);

  const [hc, current, exitsYtd, startOfYearCount, latestRun, audit, summary] = await Promise.all([
    headcount({ departmentId }),
    Employee.find({ ...deptMatch, status: inList(CURRENT), joinDate: lte(range.today) }).populate([{ path: 'department', select: 'name' }, { path: 'designation', select: 'title' }]).lean(),
    Employee.countDocuments({ ...deptMatch, status: 'exited', exitDate: between(`${year}-01-01`, range.to) }),
    Employee.countDocuments({ ...deptMatch, joinDate: lte(`${year}-01-01`), $or: [{ exitDate: null }, { exitDate: gte(`${year}-01-01`) }] }),
    PayrollRun.findOne().sort({ month: -1 }).lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).lean(),
    attendanceSummary({ from: range.from, to: range.to, departmentId }),
  ]);

  // Attrition YTD = exits in period / average headcount x 100 (brief, Section 7).
  const avgHeadcount = (startOfYearCount + hc.headcount) / 2;
  const attritionYtd = avgHeadcount > 0 ? Math.round((exitsYtd / avgHeadcount) * 1000) / 10 : 0;

  const grossOf = (e) => salaryBreakdown(e.salary?.basic).gross;
  const withSalary = current.filter((e) => e.salary?.basic > 0);
  const avgSalary = withSalary.length ? round2(withSalary.reduce((s, e) => s + grossOf(e), 0) / withSalary.length) : 0;

  const group = (keyFn) => {
    const m = new Map();
    for (const e of withSalary) {
      const k = keyFn(e);
      const g = m.get(k) ?? { count: 0, total: 0 };
      g.count += 1;
      g.total += grossOf(e);
      m.set(k, g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, employees: g.count, averageGross: round2(g.total / g.count) })).sort((a, b) => b.averageGross - a.averageGross);
  };

  let payrollByDept = [];
  if (latestRun) {
    payrollByDept = await Payslip.aggregate([
      { $match: { run: latestRun._id, ...(departmentId ? { departmentId: oid(departmentId) } : {}) } },
      { $group: { _id: '$departmentName', gross: { $sum: '$gross' }, net: { $sum: '$net' }, employees: { $sum: 1 } } },
      { $sort: { gross: -1 } },
    ]);
  }

  const gender = { male: 0, female: 0, other: 0, unspecified: 0 };
  const tenure = { '< 6 months': 0, '6-12 months': 0, '1-2 years': 0, '2+ years': 0 };
  for (const e of current) {
    gender[e.gender ?? 'unspecified'] = (gender[e.gender ?? 'unspecified'] ?? 0) + 1;
    const months = daysBetween(e.joinDate, range.today) / 30.4;
    tenure[months < 6 ? '< 6 months' : months < 12 ? '6-12 months' : months < 24 ? '1-2 years' : '2+ years'] += 1;
  }

  return {
    filters: { from: range.from, to: range.to, departmentId: departmentId ?? null },
    kpis: {
      headcount: hc.headcount,
      attritionYtd,
      exitsYtd,
      payrollCost: latestRun ? { month: latestRun.month, status: latestRun.status, gross: latestRun.totals.gross, net: latestRun.totals.net } : null,
      averageSalary: avgSalary,
      attendanceRate: summary.attendanceRate,
    },
    headcountByDepartment: hc.byDepartment,
    payrollCostByDepartment: payrollByDept.map((d) => ({ department: d._id || 'No department', gross: round2(d.gross), net: round2(d.net), employees: d.employees })),
    averageSalaryByDepartment: group((e) => e.department?.name ?? 'No department'),
    averageSalaryByDesignation: group((e) => e.designation?.title ?? 'No designation'),
    gender: Object.entries(gender).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })),
    tenure: Object.entries(tenure).map(([name, value]) => ({ name, value })),
    auditFeed: audit.map((a) => ({ id: String(a._id), action: a.action, entity: a.entity, actorName: a.actorName, actorRole: a.actorRole, createdAt: a.createdAt })),
  };
}

export async function employeeDashboard(user) {
  const cal = await loadCalendar();
  if (!user.employee) return { hasEmployeeRecord: false, today: cal.today };
  const emp = await Employee.findById(user.employee).lean();
  if (!emp) return { hasEmployeeRecord: false, today: cal.today };
  const weekStart = startOfWeek(cal.today);
  const monthStart = `${cal.today.slice(0, 7)}-01`;
  const from = weekStart < monthStart ? weekStart : monthStart;
  const data = await loadDayData({ from, to: cal.today, employeeIds: [emp._id] });
  const days = emp ? employeeDays(data.employees[0] ?? emp, data) : [];

  const weekMinutes = days.filter((d) => d.date >= weekStart).reduce((s, d) => {
    if (!d.record) return s;
    if (d.record.workedMinutes !== null && d.record.workedMinutes !== undefined) return s + d.record.workedMinutes;
    // Still working today: count time so far.
    if (d.inProgress) return s + Math.max(0, Math.round((now() - new Date(d.record.checkIn)) / 60000));
    return s;
  }, 0);
  const monthDays = days.filter((d) => d.date >= monthStart);
  const monthCounts = monthDays.reduce(countDay, emptyCounts());

  const [balances, lastPayslip] = await Promise.all([getBalances(emp._id, Number(cal.today.slice(0, 4))), listPayslips(user, { limit: 1 })]);
  const today = days.find((d) => d.date === cal.today);

  return {
    hasEmployeeRecord: true,
    today: cal.today,
    todayStatus: today?.status ?? null,
    hoursThisWeek: Math.round((weekMinutes / 60) * 10) / 10,
    weeklyTargetHours: 40,
    lateThisMonth: monthCounts.lateArrivals,
    absentThisMonth: monthCounts.absent,
    attendanceRateThisMonth: rates(monthCounts).attendanceRate,
    leaveBalances: balances,
    lastPayslip: lastPayslip[0] ?? null,
  };
}

/** Plain day-by-day counts for the AI: what happened between two dates. */
export async function attendanceForAi(user, { from, to, department } = {}) {
  const departmentId = department ? await resolveDepartment(department) : undefined;
  if (!isManager(user)) {
    // Employees only get their own numbers.
    if (!user.employee) return { error: 'No employee record' };
    const range = await resolveRange({ from, to });
    const data = await loadDayData({ from: range.from, to: range.to, employeeIds: [user.employee] });
    const emp = data.employees[0];
    const counts = emp ? employeeDays(emp, data).reduce(countDay, emptyCounts()) : emptyCounts();
    return { scope: 'own', from: range.from, to: range.to, ...counts, ...rates(counts) };
  }
  const s = await attendanceSummary({ from, to, departmentId });
  const snap = await todaySnapshot({ departmentId });
  return {
    scope: department ? `department ${department}` : 'company',
    from: s.from,
    to: s.to,
    attendanceRate: s.attendanceRate,
    latePercent: s.latePercent,
    absenteeism: s.absenteeism,
    totals: s.totals,
    today: { date: snap.date, checkedIn: snap.checkedIn, lateArrivals: snap.lateArrivals, onLeave: snap.onLeave, notCheckedIn: snap.notCheckedIn },
    byDepartment: s.byDepartment.map((d) => ({ department: d.department, attendanceRate: d.attendanceRate, absenteeism: d.absenteeism })),
  };
}

export async function resolveDepartment(name) {
  const dept = await Department.findOne({ name }).collation({ locale: 'en', strength: 2 }).lean();
  if (!dept) {
    const all = await Department.find({ isActive: true }).select('name').lean();
    const match = all.find((d) => d.name.toLowerCase().includes(String(name).toLowerCase()));
    if (match) return String(match._id);
    throw unprocessable(`Unknown department "${name}". Known: ${all.map((d) => d.name).join(', ') || 'none yet'}`, 'UNKNOWN_DEPARTMENT');
  }
  return String(dept._id);
}

