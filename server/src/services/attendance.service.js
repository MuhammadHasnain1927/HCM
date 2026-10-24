import { getDistance } from 'geolib';
import { Attendance, AttendanceCorrection } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { gte, lte } from '../utils/query.js';
import { hhmmToMinutes, localDate, localMinutes, localTime, monthRange, zonedDateTime } from '../utils/time.js';
import { isManager, assertEmployeeAccess } from '../middleware/auth.js';
import { loadCalendar } from './calendar.service.js';
import { now as clockNow } from '../utils/clock.js';
import { countDay, dayStatus, emptyCounts, employeeDays, loadDayData, rates } from './daystatus.service.js';
import { recordAudit } from './audit.service.js';
import { notifyHr, notifyUsers } from './notifications.service.js';
import { verifyFace } from './face.service.js';

const MAX_GPS_ACCURACY_M = 100;

// ---------- Rules ----------

/** Late if check-in is after office start + grace (09:00 + 15 min -> late after 09:15). */
export function checkInStatus(checkInMinutes, settings) {
  const start = hhmmToMinutes(settings.officeStart);
  const late = checkInMinutes > start + settings.graceMinutes;
  return { status: late ? 'late' : 'present', lateMinutes: late ? checkInMinutes - start : 0 };
}

/** Half day if worked less than the threshold (5 h); otherwise keeps present/late. */
export function finalStatus(checkInStatusValue, workedMinutes, settings) {
  return workedMinutes < settings.halfDayHours * 60 ? 'half_day' : checkInStatusValue;
}

// ---------- Serialization ----------

function serializeRecord(r, tz) {
  if (!r) return null;
  return {
    id: r._id.toString(),
    date: r.date,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    checkInTime: localTime(new Date(r.checkIn), tz),
    checkOutTime: r.checkOut ? localTime(new Date(r.checkOut), tz) : null,
    status: r.status,
    lateMinutes: r.lateMinutes,
    workedMinutes: r.workedMinutes,
    source: r.source,
    distanceMeters: r.location?.distanceMeters ?? null,
  };
}

function serializeDay(day, tz) {
  return {
    date: day.date,
    status: day.status,
    inProgress: Boolean(day.inProgress),
    counted: day.counted,
    holidayName: day.holidayName,
    leaveType: day.leave?.leaveType?.name ?? null,
    record: serializeRecord(day.record, tz),
  };
}

async function requireOwnEmployee(user) {
  if (!user.employee) {
    throw unprocessable('No employee record is linked to your account. Ask HR to register you as an employee.', 'NO_EMPLOYEE_RECORD');
  }
  const emp = await Employee.findById(user.employee).lean();
  if (!emp) throw notFound('Employee record not found');
  if (emp.status === 'exited') throw forbidden('Your employment has ended');
  return emp;
}

// ---------- Check in / out ----------

const officeSet = (office) => office && office.lat !== null && office.lat !== undefined && office.lng !== null && office.lng !== undefined;

/**
 * Office geofence for camera check-ins: GPS accuracy of 100 m or better and a
 * Haversine distance within the radius, decided on the server (brief, Section 5).
 * Skipped until Admin sets the office location.
 */
function checkGeofence(settings, { lat, lng, accuracy }) {
  const office = settings.office;
  if (!officeSet(office)) {
    return lat !== undefined && lng !== undefined ? { lat, lng, accuracy: accuracy ?? null, distanceMeters: null } : undefined;
  }
  if (lat === undefined || lng === undefined) throw unprocessable('Allow location access: check-in needs your location', 'LOCATION_REQUIRED');
  if (typeof accuracy !== 'number' || accuracy > MAX_GPS_ACCURACY_M) {
    throw unprocessable(`GPS accuracy is too low (${Math.round(accuracy ?? 0)} m). Move near a window and try again.`, 'GPS_INACCURATE');
  }
  const distanceMeters = getDistance({ latitude: lat, longitude: lng }, { latitude: office.lat, longitude: office.lng });
  if (distanceMeters > office.radiusMeters) {
    throw new AppError(422, 'OUTSIDE_OFFICE', `You are ${distanceMeters} m from the office (allowed ${office.radiusMeters} m)`, { distanceMeters, radiusMeters: office.radiusMeters });
  }
  return { lat, lng, accuracy, distanceMeters };
}

/**
 * Web or camera check-in. The server stamps the time; the browser only sends
 * data (brief, Section 5). With Face ID on (company setting), check-in needs a
 * live photo that matches the enrolled face, so nobody can check in for a
 * colleague; the office geofence applies whenever Admin has set a location.
 */
export async function checkIn(user, { source = 'web', lat, lng, accuracy, faceCount, photo } = {}, { ip } = {}) {
  const emp = await requireOwnEmployee(user);
  const cal = await loadCalendar();
  const now = clockNow();
  const date = localDate(now, cal.timezone);

  if (date < emp.joinDate) throw unprocessable(`Your start date is ${emp.joinDate}`, 'NOT_STARTED');

  const onLeave = await LeaveRequest.exists({ employee: emp._id, status: 'approved', startDate: lte(date), endDate: gte(date) });
  if (onLeave) throw unprocessable('You are on approved leave today', 'ON_LEAVE');

  if (await Attendance.exists({ employee: emp._id, date })) throw conflict('You have already checked in today', 'ALREADY_CHECKED_IN');

  const faceRequired = cal.settings.faceCheckInRequired !== false;
  if (faceRequired) {
    if (!photo) throw unprocessable('Check in with the camera: Face ID is required by your company', 'FACE_REQUIRED');
    source = 'camera';
  }

  let location;
  if (source === 'camera') {
    if (!faceRequired && faceCount !== 1) {
      throw unprocessable(faceCount ? 'More than one face was detected' : 'No face was detected', 'FACE_CHECK_FAILED');
    }
    location = checkGeofence(cal.settings, { lat, lng, accuracy });
  }

  let face = null;
  if (faceRequired) face = await verifyFace(user, emp, photo, { purpose: 'check-in' });


  const { status, lateMinutes } = checkInStatus(localMinutes(now, cal.timezone), cal.settings);
  let record;
  try {
    record = await Attendance.create({
      employee: emp._id,
      date,
      checkIn: now,
      status,
      lateMinutes,
      source,
      ...(location ? { location } : {}),
      ...(face ? { faceVerified: true, faceConfidence: face.confidence } : {}),
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('You have already checked in today', 'ALREADY_CHECKED_IN');
    throw err;
  }
  await recordAudit({ actor: user, action: 'attendance.check_in', entity: 'Attendance', entityId: record._id, after: record, ip });
  return serializeRecord(record, cal.timezone);
}

export async function checkOut(user, { photo } = {}, { ip } = {}) {
  const emp = await requireOwnEmployee(user);
  const cal = await loadCalendar();
  const date = localDate(clockNow(), cal.timezone);

  const found = await Attendance.findOne({ employee: emp._id, date }).select('checkOut').lean();
  if (!found) throw unprocessable('You have not checked in today', 'NOT_CHECKED_IN');
  if (found.checkOut) throw conflict('You have already checked out today', 'ALREADY_CHECKED_OUT');
  if (cal.settings.faceCheckInRequired !== false) {
    if (!photo) throw unprocessable('Check out with the camera: Face ID is required by your company', 'FACE_REQUIRED');
    await verifyFace(user, emp, photo, { purpose: 'check-out' });
  }

  // The time is stamped after the face check, and the save is conditional so two tabs cannot both check out.
  const now = clockNow();
  const record = await Attendance.findOne({ employee: emp._id, date, checkOut: null });
  if (!record) throw conflict('You have already checked out today', 'ALREADY_CHECKED_OUT');

  const before = record.toObject();
  record.checkOut = now;
  record.workedMinutes = Math.max(0, Math.round((now - record.checkIn) / 60000));
  record.status = finalStatus(record.lateMinutes > 0 ? 'late' : 'present', record.workedMinutes, cal.settings);
  await record.save();
  await recordAudit({ actor: user, action: 'attendance.check_out', entity: 'Attendance', entityId: record._id, before, after: record, ip });
  return serializeRecord(record, cal.timezone);
}

/** Today's state for the check-in widget. */
export async function getToday(user) {
  const cal = await loadCalendar();
  if (!user.employee) return { date: cal.today, hasEmployeeRecord: false, record: null, status: null };
  const emp = await Employee.findById(user.employee).lean();
  if (!emp) throw notFound('Your employee record was not found. Ask HR.');
  const data = await loadDayData({ from: cal.today, to: cal.today, employeeIds: [emp._id] });
  const day = dayStatus(emp, cal.today, data);
  return {
    date: cal.today,
    hasEmployeeRecord: true,
    status: day.status,
    workingDay: day.status !== 'weekend' && day.status !== 'holiday',
    holidayName: day.holidayName,
    record: serializeRecord(day.record, cal.timezone),
    officeStart: cal.settings.officeStart,
    officeEnd: cal.settings.officeEnd,
    graceMinutes: cal.settings.graceMinutes,
    halfDayHours: cal.settings.halfDayHours,
    officeLocationSet: officeSet(cal.settings.office),
    officeRadiusMeters: cal.settings.office?.radiusMeters ?? null,
    faceRequired: cal.settings.faceCheckInRequired !== false,
    faceEnrolled: Boolean(emp.faceEnrolledAt),
  };
}

// ---------- Calendar and board ----------

/** Month calendar for one employee (own, or any for Admin/HR). */
export async function getCalendar(user, { employeeId, month }) {
  const targetId = employeeId ?? (user.employee ? String(user.employee) : null);
  if (!targetId) throw unprocessable('No employee record is linked to your account', 'NO_EMPLOYEE_RECORD');
  assertEmployeeAccess(user, targetId);

  const { start, end } = monthRange(month);
  const data = await loadDayData({ from: start, to: end, employeeIds: [targetId] });
  const emp = data.employees[0];
  if (!emp) {
    const exists = await Employee.exists({ _id: targetId });
    if (!exists) throw notFound('Employee not found');
    return { month, employee: null, days: [], counts: emptyCounts(), rates: rates(emptyCounts()) };
  }
  const days = employeeDays(emp, data);
  const counts = days.reduce(countDay, emptyCounts());
  const workedMinutes = days.reduce((sum, d) => sum + (d.record?.workedMinutes ?? 0), 0);
  return {
    month,
    employee: { id: String(emp._id), name: emp.name, code: emp.code },
    days: days.map((d) => serializeDay(d, data.calendar.timezone)),
    counts,
    rates: rates(counts),
    workedHours: Math.round((workedMinutes / 60) * 10) / 10,
  };
}

/** Daily attendance board for Admin and HR. */
export async function getBoard({ date, departmentId }) {
  const cal = await loadCalendar();
  const day = date ?? cal.today;
  const data = await loadDayData({ from: day, to: day, departmentId });
  const rows = data.employees
    .map((emp) => {
      const d = dayStatus(emp, day, data);
      return {
        employeeId: String(emp._id),
        code: emp.code,
        name: emp.name,
        departmentName: emp.department?.name ?? null,
        designationTitle: emp.designation?.title ?? null,
        ...serializeDay(d, cal.timezone),
      };
    })
    .filter((r) => r.status !== 'not_employed')
    .sort((a, b) => a.name.localeCompare(b.name));

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  return { date: day, today: cal.today, total: rows.length, summary, rows };
}

// ---------- Corrections ----------

const serializeCorrection = (c) => ({
  id: c._id.toString(),
  employeeId: String(c.employee?._id ?? c.employee),
  employeeName: c.employee?.name ?? null,
  employeeCode: c.employee?.code ?? null,
  date: c.date,
  checkIn: c.checkIn,
  checkOut: c.checkOut,
  reason: c.reason,
  status: c.status,
  reviewComment: c.reviewComment,
  reviewedAt: c.reviewedAt,
  createdAt: c.createdAt,
});

export async function requestCorrection(user, { date, checkIn, checkOut, reason }, { ip } = {}) {
  const emp = await requireOwnEmployee(user);
  const cal = await loadCalendar();
  if (date > cal.today) throw unprocessable('You cannot correct a future day', 'INVALID_DATE', [{ field: 'date', message: 'Pick today or an earlier day' }]);
  if (date < emp.joinDate) throw unprocessable('This day is before your start date', 'INVALID_DATE', [{ field: 'date', message: 'Before your start date' }]);
  if (checkOut && hhmmToMinutes(checkOut) <= hhmmToMinutes(checkIn)) {
    throw unprocessable('Check-out must be after check-in', 'INVALID_TIME', [{ field: 'checkOut', message: 'Must be after check-in' }]);
  }
  if (await AttendanceCorrection.exists({ employee: emp._id, date, status: 'pending' })) {
    throw conflict('You already have a pending correction for this day', 'DUPLICATE');
  }
  const c = await AttendanceCorrection.create({ employee: emp._id, date, checkIn, checkOut: checkOut ?? null, reason, requestedBy: user._id });
  await recordAudit({ actor: user, action: 'attendance.correction_request', entity: 'AttendanceCorrection', entityId: c._id, after: c, ip });
  await notifyHr(
    { type: 'correction.requested', title: `Attendance correction from ${emp.name}`, body: `${date}: ${reason}`, link: '/attendance?tab=corrections' },
    { exceptUserId: user._id },
  );
  return serializeCorrection(c);
}

export async function listCorrections(user, { status, employeeId }) {
  const filter = {};
  if (status) filter.status = status;
  if (!isManager(user)) {
    if (!user.employee) return [];
    filter.employee = user.employee;
  } else if (employeeId) filter.employee = employeeId;
  const rows = await AttendanceCorrection.find(filter).populate('employee', 'name code').sort({ createdAt: -1 }).limit(200).lean();
  return rows.map(serializeCorrection);
}

/** HR approves (writes the attendance record) or rejects a correction. */
export async function decideCorrection(actor, id, { decision, comment }, { ip } = {}) {
  const c = await AttendanceCorrection.findById(id).populate('employee', 'name user joinDate');
  if (!c) throw notFound('Correction not found');
  if (c.status !== 'pending') throw unprocessable(`This correction was already ${c.status}`, 'ALREADY_DECIDED');
  if (actor.employee && String(actor.employee) === String(c.employee._id)) {
    throw forbidden('You cannot approve your own correction. Ask another HR member.');
  }
  if (decision === 'rejected' && !comment) {
    throw unprocessable('Add a comment explaining the rejection', 'COMMENT_REQUIRED', [{ field: 'comment', message: 'Required when rejecting' }]);
  }

  const cal = await loadCalendar();
  if (decision === 'approved') {
    const checkInAt = zonedDateTime(c.date, c.checkIn, cal.timezone);
    const checkOutAt = c.checkOut ? zonedDateTime(c.date, c.checkOut, cal.timezone) : null;
    const { status: inStatus, lateMinutes } = checkInStatus(hhmmToMinutes(c.checkIn), cal.settings);
    const workedMinutes = checkOutAt ? Math.round((checkOutAt - checkInAt) / 60000) : null;
    const status = workedMinutes === null ? inStatus : finalStatus(inStatus, workedMinutes, cal.settings);
    const before = await Attendance.findOne({ employee: c.employee._id, date: c.date }).lean();
    const record = await Attendance.findOneAndUpdate(
      { employee: c.employee._id, date: c.date },
      { $set: { checkIn: checkInAt, checkOut: checkOutAt, status, lateMinutes, workedMinutes, source: 'correction' } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    await recordAudit({ actor, action: 'attendance.correct', entity: 'Attendance', entityId: record._id, before, after: record, ip });
  }

  c.status = decision;
  c.reviewedBy = actor._id;
  c.reviewComment = comment ?? '';
  c.reviewedAt = new Date();
  await c.save();
  await recordAudit({ actor, action: `attendance.correction_${decision === 'approved' ? 'approve' : 'reject'}`, entity: 'AttendanceCorrection', entityId: c._id, after: c, ip });
  await notifyUsers([c.employee.user], {
    type: 'correction.decided',
    title: `Attendance correction ${decision}`,
    body: `${c.date}${comment ? `: ${comment}` : ''}`,
    link: '/attendance',
  });
  return serializeCorrection(c);
}
