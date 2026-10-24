import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveType } from '../models/LeaveType.js';
import { Employee } from '../models/Employee.js';
import { forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { between, gte, inList, lte, ne } from '../utils/query.js';
import { pageInfo } from '../utils/validators.js';
import { workingDaysBetween } from '../utils/time.js';
import { assertEmployeeAccess, isManager } from '../middleware/auth.js';
import { loadCalendar } from './calendar.service.js';
import { recordAudit } from './audit.service.js';
import { notifyHr, notifyUsers } from './notifications.service.js';

const ACTIVE_STATUSES = ['pending', 'approved'];

// ---------- Serialization ----------

function serializeLeave(l) {
  return {
    id: l._id.toString(),
    employeeId: String(l.employee?._id ?? l.employee),
    employeeName: l.employee?.name ?? null,
    employeeCode: l.employee?.code ?? null,
    departmentName: l.employee?.department?.name ?? null,
    leaveTypeId: String(l.leaveType?._id ?? l.leaveType),
    leaveTypeName: l.leaveType?.name ?? null,
    leaveTypeCode: l.leaveType?.code ?? null,
    isPaid: l.leaveType?.isPaid ?? null,
    startDate: l.startDate,
    endDate: l.endDate,
    days: l.days,
    reason: l.reason,
    status: l.status,
    source: l.source,
    reviewComment: l.reviewComment,
    reviewedAt: l.reviewedAt,
    createdAt: l.createdAt,
  };
}

const POPULATE = [
  { path: 'employee', select: 'name code department user', populate: { path: 'department', select: 'name' } },
  { path: 'leaveType', select: 'name code isPaid yearlyQuota' },
];

// ---------- Day counting and balances ----------

/** Working days between two dates (weekends and holidays skipped). */
export async function countLeaveDays(startDate, endDate) {
  const cal = await loadCalendar({ from: startDate, to: endDate });
  return workingDaysBetween(startDate, endDate, cal).length;
}

/**
 * Balance per leave type for a year: quota, approved (used), pending and
 * remaining = quota - approved (brief: "own balance after approved leaves").
 * `available` also holds back pending days so requests cannot over-commit.
 */
export async function getBalances(employeeId, year) {
  const [types, requests] = await Promise.all([
    LeaveType.find({ isActive: true }).sort({ isSystem: -1, name: 1 }).lean(),
    LeaveRequest.find({
      employee: employeeId,
      status: inList(ACTIVE_STATUSES),
      startDate: between(`${year}-01-01`, `${year}-12-31`),
    }).lean(),
  ]);
  return types.map((t) => {
    const mine = requests.filter((r) => String(r.leaveType) === String(t._id));
    const used = mine.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0);
    const pending = mine.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
    const unlimited = t.yearlyQuota === null;
    return {
      leaveTypeId: String(t._id),
      code: t.code,
      name: t.name,
      isPaid: t.isPaid,
      quota: t.yearlyQuota,
      used,
      pending,
      remaining: unlimited ? null : Math.max(0, t.yearlyQuota - used),
      available: unlimited ? null : Math.max(0, t.yearlyQuota - used - pending),
    };
  });
}

export async function getBalancesFor(user, { employeeId, year }) {
  const target = employeeId ?? (user.employee ? String(user.employee) : null);
  if (!target) throw unprocessable('No employee record is linked to your account', 'NO_EMPLOYEE_RECORD');
  assertEmployeeAccess(user, target);
  const cal = await loadCalendar();
  const y = year ?? Number(cal.today.slice(0, 4));
  return { year: y, employeeId: target, balances: await getBalances(target, y) };
}

/** Checks overlap and balance for a request (used on apply and again on approval). */
async function validateRequest({ employeeId, leaveType, startDate, endDate, days, excludeId }) {
  const overlapFilter = {
    employee: employeeId,
    status: inList(ACTIVE_STATUSES),
    startDate: lte(endDate),
    endDate: gte(startDate),
    ...(excludeId ? { _id: ne(excludeId) } : {}),
  };
  const overlap = await LeaveRequest.findOne(overlapFilter).lean();
  if (overlap) {
    throw unprocessable(
      `These dates overlap a ${overlap.status} request (${overlap.startDate} to ${overlap.endDate})`,
      'LEAVE_OVERLAP',
      [{ field: 'startDate', message: 'Overlaps another request' }],
    );
  }
  if (leaveType.yearlyQuota !== null) {
    const balances = await getBalances(employeeId, Number(startDate.slice(0, 4)));
    const b = balances.find((x) => x.leaveTypeId === String(leaveType._id));
    // When re-validating an existing pending request, its own days are inside "pending".
    const available = (b?.available ?? leaveType.yearlyQuota) + (excludeId ? days : 0);
    if (days > available) {
      throw unprocessable(
        `Not enough ${leaveType.name.toLowerCase()} left: ${available} day(s) available, ${days} requested`,
        'INSUFFICIENT_BALANCE',
        [{ field: 'leaveTypeId', message: `${available} day(s) available` }],
      );
    }
  }
}

// ---------- Apply, cancel, decide ----------

export async function applyLeave(user, { leaveTypeId, startDate, endDate, reason, source = 'form' }, { ip } = {}) {
  if (!user.employee) {
    throw unprocessable('No employee record is linked to your account. Ask HR to register you as an employee.', 'NO_EMPLOYEE_RECORD');
  }
  const emp = await Employee.findById(user.employee).lean();
  if (!emp || emp.status === 'exited') throw forbidden('Your employment has ended');
  if (endDate < startDate) throw unprocessable('End date must be on or after the start date', 'INVALID_DATES', [{ field: 'endDate', message: 'Must be on or after the start date' }]);
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    throw unprocessable('Split leave that crosses into a new year into two requests', 'INVALID_DATES', [{ field: 'endDate', message: 'Same year as the start date' }]);
  }
  if (startDate < emp.joinDate) throw unprocessable('Leave cannot start before your join date', 'INVALID_DATES', [{ field: 'startDate', message: 'Before your join date' }]);

  const leaveType = await LeaveType.findById(leaveTypeId).lean();
  if (!leaveType || !leaveType.isActive) throw unprocessable('Pick an active leave type', 'INVALID_LEAVE_TYPE', [{ field: 'leaveTypeId', message: 'Pick an active leave type' }]);

  const days = await countLeaveDays(startDate, endDate);
  if (days === 0) throw unprocessable('These dates are all weekends or public holidays', 'NO_WORKING_DAYS', [{ field: 'startDate', message: 'No working days in this range' }]);

  await validateRequest({ employeeId: emp._id, leaveType, startDate, endDate, days });

  const leave = await LeaveRequest.create({
    employee: emp._id,
    leaveType: leaveType._id,
    startDate,
    endDate,
    days,
    reason: reason ?? '',
    source,
    requestedBy: user._id,
  });
  await recordAudit({ actor: user, action: 'leave.apply', entity: 'LeaveRequest', entityId: leave._id, after: leave, ip });
  await notifyHr(
    {
      type: 'leave.requested',
      title: `Leave request from ${emp.name}`,
      body: `${leaveType.name}: ${startDate} to ${endDate} (${days} day${days === 1 ? '' : 's'})`,
      link: '/leave?tab=approvals',
    },
    { exceptUserId: user._id },
  );
  await leave.populate(POPULATE);
  return serializeLeave(leave);
}

export async function cancelLeave(user, id, { ip } = {}) {
  const leave = await LeaveRequest.findById(id);
  if (!leave) throw notFound('Leave request not found');
  if (!user.employee || String(leave.employee) !== String(user.employee)) throw forbidden('You can only cancel your own leave');
  const cal = await loadCalendar();
  if (leave.status === 'approved' && leave.startDate <= cal.today) {
    throw unprocessable('Leave that has already started cannot be cancelled. Ask HR.', 'CANNOT_CANCEL');
  }
  if (!['pending', 'approved'].includes(leave.status)) throw unprocessable(`This request is already ${leave.status}`, 'CANNOT_CANCEL');

  const before = leave.toObject();
  leave.status = 'cancelled';
  leave.cancelledAt = new Date();
  await leave.save();
  await recordAudit({ actor: user, action: 'leave.cancel', entity: 'LeaveRequest', entityId: leave._id, before, after: leave, ip });
  await leave.populate(POPULATE);
  return serializeLeave(leave);
}

/** HR approves or rejects with a comment (brief #13). */
export async function decideLeave(actor, id, { decision, comment }, { ip } = {}) {
  const leave = await LeaveRequest.findById(id).populate(POPULATE);
  if (!leave) throw notFound('Leave request not found');
  if (leave.status !== 'pending') throw unprocessable(`This request is already ${leave.status}`, 'ALREADY_DECIDED');
  if (actor.employee && String(actor.employee) === String(leave.employee._id)) {
    throw forbidden('You cannot approve your own leave. Ask another HR member.');
  }
  if (decision === 'rejected' && !comment) {
    throw unprocessable('Add a comment explaining the rejection', 'COMMENT_REQUIRED', [{ field: 'comment', message: 'Required when rejecting' }]);
  }
  if (decision === 'approved') {
    await validateRequest({
      employeeId: leave.employee._id,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: leave.days,
      excludeId: leave._id,
    });
  }

  const before = leave.toObject();
  leave.status = decision;
  leave.reviewedBy = actor._id;
  leave.reviewComment = comment ?? '';
  leave.reviewedAt = new Date();
  await leave.save();
  await recordAudit({ actor, action: decision === 'approved' ? 'leave.approve' : 'leave.reject', entity: 'LeaveRequest', entityId: leave._id, before, after: leave, ip });
  await notifyUsers([leave.employee.user], {
    type: 'leave.decided',
    title: `Your ${leave.leaveType.name.toLowerCase()} was ${decision}`,
    body: `${leave.startDate} to ${leave.endDate}${comment ? ` - ${comment}` : ''}`,
    link: '/leave',
  });
  return serializeLeave(leave);
}

// ---------- Lists ----------

export async function listLeaves(user, { status, employeeId, departmentId, leaveTypeId, from, to, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (leaveTypeId) filter.leaveType = leaveTypeId;
  if (from) filter.endDate = gte(from);
  if (to) filter.startDate = lte(to);

  if (!isManager(user)) {
    if (!user.employee) return { items: [], ...pageInfo({ page, limit }, 0) };
    filter.employee = user.employee;
  } else if (employeeId) {
    filter.employee = employeeId;
  } else if (departmentId) {
    const ids = await Employee.find({ department: departmentId }).distinct('_id');
    filter.employee = inList(ids);
  }

  const [rows, total] = await Promise.all([
    LeaveRequest.find(filter)
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LeaveRequest.countDocuments(filter),
  ]);
  return { items: rows.map(serializeLeave), ...pageInfo({ page, limit }, total) };
}

/** Who is on approved leave on a date (for the board, dashboards and the AI). */
export async function whoIsOnLeave({ date, departmentId }) {
  const filter = { status: 'approved', startDate: lte(date), endDate: gte(date) };
  if (departmentId) {
    const ids = await Employee.find({ department: departmentId }).distinct('_id');
    filter.employee = inList(ids);
  }
  const rows = await LeaveRequest.find(filter).populate(POPULATE).lean();
  return rows.map((l) => ({
    employeeName: l.employee?.name,
    employeeCode: l.employee?.code,
    departmentName: l.employee?.department?.name ?? null,
    leaveType: l.leaveType?.name,
    leaveTypeCode: l.leaveType?.code,
    startDate: l.startDate,
    endDate: l.endDate,
  }));
}
