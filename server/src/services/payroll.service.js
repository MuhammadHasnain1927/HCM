import { PayrollRun, Payslip } from '../models/Payroll.js';
import { round2 } from '../models/Employee.js';
import { AppError, notFound, unprocessable } from '../utils/AppError.js';
import { monthRange } from '../utils/time.js';
import { isManager } from '../middleware/auth.js';
import { loadCalendar } from './calendar.service.js';
import { loadDayData } from './daystatus.service.js';
import { calculatePayslip } from './payroll.calc.js';
import { recordAudit } from './audit.service.js';
import { notifyUsers } from './notifications.service.js';

const locked = () => new AppError(423, 'PAYROLL_LOCKED', 'This payroll run is finalized and locked');

const MONEY_FIELDS = ['basic', 'hra', 'medical', 'gross', 'perDay', 'earned', 'deductions', 'tax', 'net'];

export function serializePayslip(p) {
  const out = {
    id: p._id.toString(),
    runId: String(p.run),
    month: p.month,
    status: p.status,
    employeeId: String(p.employee),
    employeeCode: p.employeeCode,
    employeeName: p.employeeName,
    departmentName: p.departmentName,
    designationTitle: p.designationTitle,
    workingDays: p.workingDays,
    employedDays: p.employedDays,
    absentDays: p.absentDays,
    unpaidLeaveDays: p.unpaidLeaveDays,
    halfDays: p.halfDays,
    lateDays: p.lateDays,
    latePenaltyDays: p.latePenaltyDays,
    deductionDays: p.deductionDays,
    yearlyTaxableIncome: p.yearlyTaxableIncome,
    prorated: p.prorated,
  };
  for (const f of MONEY_FIELDS) out[f] = p[f];
  return out;
}

function serializeRun(r) {
  return {
    id: r._id.toString(),
    month: r.month,
    status: r.status,
    workingDays: r.workingDays,
    totals: r.totals,
    skipped: r.skipped ?? [],
    calculatedAt: r.calculatedAt,
    finalizedAt: r.finalizedAt,
    createdAt: r.createdAt,
  };
}

/** Calculates every payslip for the run's month from current records. */
async function calculateRun(run) {
  const { start, end } = monthRange(run.month);
  const data = await loadDayData({ from: start, to: end });
  const latePenalty = Boolean(data.calendar.settings.latePenaltyEnabled);

  const slips = [];
  const skipped = [];
  for (const emp of data.employees) {
    if (!(emp.salary?.basic > 0)) {
      skipped.push({ employeeId: String(emp._id), name: emp.name, reason: 'No salary structure set' });
      continue;
    }
    const slip = calculatePayslip(emp, run.month, data, { latePenalty });
    if (slip.employedDays === 0) {
      skipped.push({ employeeId: String(emp._id), name: emp.name, reason: 'No working days employed in this month' });
      continue;
    }
    slips.push({ ...slip, run: run._id, month: run.month, status: 'draft' });
  }

  if (!run.isNew && !(await PayrollRun.exists({ _id: run._id, status: 'draft' }))) throw locked();
  await Payslip.deleteMany({ run: run._id });
  if (slips.length) await Payslip.insertMany(slips);

  const sum = (f) => round2(slips.reduce((s, p) => s + p[f], 0));
  run.totals = { employees: slips.length, gross: sum('gross'), earned: sum('earned'), deductions: sum('deductions'), tax: sum('tax'), net: sum('net') };
  run.workingDays = slips[0]?.workingDays ?? 0;
  run.skipped = skipped;
  run.calculatedAt = new Date();
  await run.save();
  return run;
}

/** HR creates (or recalculates) the draft for a month (brief #15). */
export async function createRun(actor, { month }, { ip } = {}) {
  const cal = await loadCalendar();
  if (month > cal.today.slice(0, 7)) {
    throw unprocessable('Payroll can only be run for the current or a past month', 'FUTURE_MONTH', [{ field: 'month', message: 'Pick this month or an earlier one' }]);
  }
  let run = await PayrollRun.findOne({ month });
  if (run?.status === 'finalized') throw locked();
  const isNew = !run;
  if (!run) run = new PayrollRun({ month, createdBy: actor._id });
  await calculateRun(run);
  await recordAudit({ actor, action: isNew ? 'payroll.create' : 'payroll.recalculate', entity: 'PayrollRun', entityId: run._id, after: serializeRun(run), ip });
  return getRun(run._id);
}

export async function recalculateRun(actor, id, { ip } = {}) {
  const run = await PayrollRun.findById(id);
  if (!run) throw notFound('Payroll run not found');
  if (run.status === 'finalized') throw locked();
  const before = serializeRun(run);
  await calculateRun(run);
  await recordAudit({ actor, action: 'payroll.recalculate', entity: 'PayrollRun', entityId: run._id, before, after: serializeRun(run), ip });
  return getRun(run._id);
}

/** Only Admin finalizes; finalized runs are locked (brief #16). */
export async function finalizeRun(actor, id, { ip } = {}) {
  const run = await PayrollRun.findById(id);
  if (!run) throw notFound('Payroll run not found');
  if (run.status === 'finalized') throw locked();
  if (!run.totals?.employees) throw unprocessable('This run has no payslips to finalize', 'EMPTY_RUN');

  const before = serializeRun(run);
  // Atomic: only one finalize can win, and only while the run is still a draft.
  const updated = await PayrollRun.findOneAndUpdate(
    { _id: run._id, status: 'draft' },
    { $set: { status: 'finalized', finalizedBy: actor._id, finalizedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw locked();
  run.status = updated.status;
  run.finalizedAt = updated.finalizedAt;
  await Payslip.updateMany({ run: run._id }, { status: 'finalized' });
  await recordAudit({ actor, action: 'payroll.finalize', entity: 'PayrollRun', entityId: run._id, before, after: serializeRun(run), ip });

  const slips = await Payslip.find({ run: run._id }).populate('employee', 'user').lean();
  await notifyUsers(
    slips.map((s) => s.employee?.user),
    { type: 'payslip.ready', title: `Your payslip for ${run.month} is ready`, body: 'Download it from My payslips.', link: '/payslips' },
  );
  return getRun(run._id);
}

export async function listRuns() {
  const runs = await PayrollRun.find().sort({ month: -1 }).limit(36).lean();
  return runs.map(serializeRun);
}

export async function getRun(id) {
  const run = await PayrollRun.findById(id).lean();
  if (!run) throw notFound('Payroll run not found');
  const slips = await Payslip.find({ run: run._id }).collation({ locale: 'en' }).sort({ employeeName: 1 }).lean();
  return { ...serializeRun(run), payslips: slips.map(serializePayslip) };
}

/**
 * Payslips visible to the caller: Admin and HR see all; Employees see only
 * their own finalized payslips (brief #17).
 */
export async function listPayslips(user, { employeeId, month, limit = 24 } = {}) {
  const filter = {};
  if (isManager(user)) {
    if (employeeId) filter.employee = employeeId;
  } else {
    if (!user.employee) return [];
    filter.employee = user.employee;
    filter.status = 'finalized';
  }
  if (month) filter.month = month;
  const rows = await Payslip.find(filter).sort({ month: -1 }).limit(limit).lean();
  return rows.map(serializePayslip);
}

export async function getPayslip(user, id) {
  const p = await Payslip.findById(id).lean();
  if (!p) throw notFound('Payslip not found');
  if (!isManager(user)) {
    if (!user.employee || String(p.employee) !== String(user.employee) || p.status !== 'finalized') throw notFound('Payslip not found');
  }
  return serializePayslip(p);
}

/** Payroll totals for the AI tool and dashboards. */
export async function payrollSummary(user, { month } = {}) {
  if (!isManager(user)) {
    const mine = await listPayslips(user, { month, limit: 1 });
    return { scope: 'own', payslip: mine[0] ?? null };
  }
  const run = month ? await PayrollRun.findOne({ month }).lean() : await PayrollRun.findOne().sort({ month: -1 }).lean();
  if (!run) return { scope: 'company', run: null };
  const byDept = await Payslip.aggregate([
    { $match: { run: run._id } },
    { $group: { _id: '$departmentName', employees: { $sum: 1 }, gross: { $sum: '$gross' }, net: { $sum: '$net' } } },
    { $sort: { gross: -1 } },
  ]);
  return {
    scope: 'company',
    run: serializeRun(run),
    byDepartment: byDept.map((d) => ({ department: d._id || 'No department', employees: d.employees, gross: round2(d.gross), net: round2(d.net) })),
  };
}
