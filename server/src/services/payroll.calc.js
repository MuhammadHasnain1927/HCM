import { round2, salaryBreakdown } from '../models/Employee.js';
import { isWorkingDay, monthRange, workingDaysBetween } from '../utils/time.js';
import { employeeDays } from './daystatus.service.js';

/**
 * Yearly income tax (brief, Section 3, M6 - illustrative slabs):
 *   0 to 600k: 0
 *   to 1.2M:   5% of the amount over 600k
 *   to 2.4M:   30k + 15% over 1.2M
 *   to 3.6M:   210k + 25% over 2.4M
 *   above:     510k + 35% over 3.6M
 */
export function yearlyTax(income) {
  const y = Math.max(0, income);
  if (y <= 600000) return 0;
  if (y <= 1200000) return 0.05 * (y - 600000);
  if (y <= 2400000) return 30000 + 0.15 * (y - 1200000);
  if (y <= 3600000) return 210000 + 0.25 * (y - 2400000);
  return 510000 + 0.35 * (y - 3600000);
}

/**
 * One employee's payslip for a month, from the shared day statuses:
 *   per day     = gross / working days in the month
 *   earned      = per day x days employed in the month (prorates joiners and leavers)
 *   deductions  = per day x (absent + unpaid leave + 0.5 x half days [+ late penalty])
 *   tax         = slab(gross x 12) / 12, prorated like earned
 *   net         = earned - deductions - tax
 */
export function calculatePayslip(employee, month, dayData, { latePenalty = false } = {}) {
  const { start, end } = monthRange(month);
  const cal = dayData.calendar;
  const workingDays = workingDaysBetween(start, end, cal).length;
  const pay = salaryBreakdown(employee.salary?.basic ?? 0);

  const days = employeeDays(employee, dayData);
  const employedWorkingDays = days.filter((d) => d.status !== 'not_employed' && isWorkingDay(d.date, cal)).length;

  let absentDays = 0;
  let unpaidLeaveDays = 0;
  let halfDays = 0;
  let lateDays = 0;
  for (const d of days) {
    if (!d.counted) continue;
    if (d.status === 'absent') absentDays += 1;
    else if (d.status === 'on_leave' && d.leave?.leaveType && d.leave.leaveType.isPaid === false) unpaidLeaveDays += 1;
    else if (d.status === 'half_day') halfDays += 1;
    if (d.status === 'late' || (d.record && d.record.lateMinutes > 0)) lateDays += 1;
  }

  // Bonus rule (off by default): every 3 late days cost half a day.
  const latePenaltyDays = latePenalty ? Math.floor(lateDays / 3) * 0.5 : 0;
  const perDay = workingDays > 0 ? pay.gross / workingDays : 0;
  const earned = perDay * employedWorkingDays;
  const deductionDays = absentDays + unpaidLeaveDays + 0.5 * halfDays + latePenaltyDays;
  const deductions = Math.min(earned, perDay * deductionDays);
  const prorateFactor = workingDays > 0 ? employedWorkingDays / workingDays : 0;
  const tax = (yearlyTax(pay.gross * 12) / 12) * prorateFactor;
  const net = Math.max(0, earned - deductions - tax);

  return {
    employee: employee._id,
    employeeCode: employee.code,
    employeeName: employee.name,
    departmentId: employee.department?._id ?? employee.department ?? null,
    departmentName: employee.department?.name ?? '',
    designationTitle: employee.designation?.title ?? '',
    ...pay,
    workingDays,
    employedDays: employedWorkingDays,
    perDay: round2(perDay),
    earned: round2(earned),
    absentDays,
    unpaidLeaveDays,
    halfDays,
    lateDays,
    latePenaltyDays,
    deductionDays,
    deductions: round2(deductions),
    yearlyTaxableIncome: round2(pay.gross * 12),
    tax: round2(tax),
    net: round2(net),
    prorated: employedWorkingDays < workingDays,
  };
}
