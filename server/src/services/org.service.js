import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { LeaveType, DEFAULT_LEAVE_TYPES } from '../models/LeaveType.js';
import { Holiday } from '../models/Holiday.js';
import { conflict, notFound, unprocessable } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

// ---------- Departments ----------

const serializeDepartment = (d, designationCount) => ({
  id: d._id.toString(),
  name: d.name,
  description: d.description,
  isActive: d.isActive,
  ...(designationCount !== undefined ? { designationCount } : {}),
  createdAt: d.createdAt,
});

export async function listDepartments({ includeArchived = false } = {}) {
  const filter = includeArchived ? {} : { isActive: true };
  const [departments, counts] = await Promise.all([
    Department.find(filter).collation({ locale: 'en' }).sort({ name: 1 }),
    Designation.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$department', count: { $sum: 1 } } }]),
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.count]));
  return departments.map((d) => serializeDepartment(d, countBy.get(String(d._id)) ?? 0));
}

export async function createDepartment(actor, data, { ip } = {}) {
  const dept = await Department.create(data);
  await recordAudit({ actor, action: 'department.create', entity: 'Department', entityId: dept._id, after: dept, ip });
  return serializeDepartment(dept);
}

export async function updateDepartment(actor, id, changes, { ip } = {}) {
  const dept = await Department.findById(id);
  if (!dept) throw notFound('Department not found');
  const before = dept.toObject();
  dept.set(changes);
  await dept.save();
  await recordAudit({ actor, action: 'department.update', entity: 'Department', entityId: dept._id, before, after: dept, ip });
  return serializeDepartment(dept);
}

// ---------- Designations ----------

const serializeDesignation = (d) => ({
  id: d._id.toString(),
  title: d.title,
  departmentId: d.department?._id ? d.department._id.toString() : String(d.department),
  departmentName: d.department?.name ?? null,
  isActive: d.isActive,
  createdAt: d.createdAt,
});

export async function listDesignations({ departmentId, includeArchived = false } = {}) {
  const filter = {
    ...(includeArchived ? {} : { isActive: true }),
    ...(departmentId ? { department: departmentId } : {}),
  };
  const rows = await Designation.find(filter).populate('department', 'name').collation({ locale: 'en' }).sort({ title: 1 });
  return rows.map(serializeDesignation);
}

async function assertActiveDepartment(departmentId) {
  const dept = await Department.findById(departmentId).select('isActive');
  if (!dept) throw unprocessable('Department not found', 'INVALID_DEPARTMENT', [{ field: 'departmentId', message: 'Pick an existing department' }]);
  if (!dept.isActive) throw unprocessable('Department is archived', 'INVALID_DEPARTMENT', [{ field: 'departmentId', message: 'This department is archived' }]);
}

export async function createDesignation(actor, { title, departmentId }, { ip } = {}) {
  await assertActiveDepartment(departmentId);
  const row = await Designation.create({ title, department: departmentId });
  await row.populate('department', 'name');
  await recordAudit({ actor, action: 'designation.create', entity: 'Designation', entityId: row._id, after: row, ip });
  return serializeDesignation(row);
}

export async function updateDesignation(actor, id, { title, departmentId, isActive }, { ip } = {}) {
  const row = await Designation.findById(id);
  if (!row) throw notFound('Designation not found');
  const before = row.toObject();
  if (departmentId !== undefined && String(row.department) !== departmentId) {
    await assertActiveDepartment(departmentId);
    row.department = departmentId;
  }
  if (title !== undefined) row.title = title;
  if (isActive !== undefined) row.isActive = isActive;
  await row.save();
  await row.populate('department', 'name');
  await recordAudit({ actor, action: 'designation.update', entity: 'Designation', entityId: row._id, before, after: row, ip });
  return serializeDesignation(row);
}

// ---------- Leave types ----------

const serializeLeaveType = (t) => ({
  id: t._id.toString(),
  code: t.code,
  name: t.name,
  yearlyQuota: t.yearlyQuota,
  isPaid: t.isPaid,
  isSystem: t.isSystem,
  isActive: t.isActive,
});

/** Creates the brief's built-in leave types if missing. Safe to run more than once. */
export async function ensureDefaultLeaveTypes() {
  await LeaveType.bulkWrite(
    DEFAULT_LEAVE_TYPES.map((t) => ({
      updateOne: {
        filter: { code: t.code },
        update: { $setOnInsert: { ...t, isSystem: true, isActive: true } },
        upsert: true,
      },
    })),
  );
}

export async function listLeaveTypes({ includeArchived = false } = {}) {
  const rows = await LeaveType.find(includeArchived ? {} : { isActive: true }).sort({ isSystem: -1, name: 1 });
  return rows.map(serializeLeaveType);
}

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

export async function createLeaveType(actor, { name, yearlyQuota, isPaid }, { ip } = {}) {
  let code = slugify(name);
  if (code.length < 2) code = `type_${Date.now().toString(36)}`;
  if (await LeaveType.exists({ code })) code = `${code.slice(0, 24)}_${Date.now().toString(36).slice(-5)}`;

  const row = await LeaveType.create({ code, name, yearlyQuota, isPaid });
  await recordAudit({ actor, action: 'leave_type.create', entity: 'LeaveType', entityId: row._id, after: row, ip });
  return serializeLeaveType(row);
}

export async function updateLeaveType(actor, id, changes, { ip } = {}) {
  const row = await LeaveType.findById(id);
  if (!row) throw notFound('Leave type not found');
  const before = row.toObject();

  if (row.isSystem && changes.isActive === false) {
    throw unprocessable('Built-in leave types cannot be archived', 'SYSTEM_LEAVE_TYPE');
  }
  if (row.code === 'unpaid') {
    // Unpaid leave is unlimited and unpaid by definition (brief, Section 3).
    if (changes.yearlyQuota !== undefined && changes.yearlyQuota !== null) {
      throw unprocessable('Unpaid leave has no yearly limit', 'SYSTEM_LEAVE_TYPE', [{ field: 'yearlyQuota', message: 'Unpaid leave is unlimited' }]);
    }
    if (changes.isPaid === true) throw unprocessable('Unpaid leave cannot be paid', 'SYSTEM_LEAVE_TYPE');
  } else if (row.isSystem && changes.isPaid === false) {
    throw unprocessable('Built-in paid leave types must stay paid', 'SYSTEM_LEAVE_TYPE');
  }

  row.set(changes);
  await row.save();
  await recordAudit({ actor, action: 'leave_type.update', entity: 'LeaveType', entityId: row._id, before, after: row, ip });
  return serializeLeaveType(row);
}

// ---------- Holidays ----------

const serializeHoliday = (h) => ({ id: h._id.toString(), date: h.date, name: h.name });

export async function listHolidays({ year } = {}) {
  const filter = year ? { date: new RegExp(`^${year}-`) } : {};
  const rows = await Holiday.find(filter).sort({ date: 1 });
  return rows.map(serializeHoliday);
}

export async function createHoliday(actor, data, { ip } = {}) {
  let row;
  try {
    row = await Holiday.create(data);
  } catch (err) {
    if (err?.code === 11000) throw conflict(`A holiday already exists on ${data.date}`, 'DUPLICATE');
    throw err;
  }
  await recordAudit({ actor, action: 'holiday.create', entity: 'Holiday', entityId: row._id, after: row, ip });
  return serializeHoliday(row);
}

export async function updateHoliday(actor, id, changes, { ip } = {}) {
  const row = await Holiday.findById(id);
  if (!row) throw notFound('Holiday not found');
  const before = row.toObject();
  row.set(changes);
  try {
    await row.save();
  } catch (err) {
    if (err?.code === 11000) throw conflict(`A holiday already exists on ${changes.date}`, 'DUPLICATE');
    throw err;
  }
  await recordAudit({ actor, action: 'holiday.update', entity: 'Holiday', entityId: row._id, before, after: row, ip });
  return serializeHoliday(row);
}

export async function deleteHoliday(actor, id, { ip } = {}) {
  const row = await Holiday.findById(id);
  if (!row) throw notFound('Holiday not found');
  await row.deleteOne();
  await recordAudit({ actor, action: 'holiday.delete', entity: 'Holiday', entityId: row._id, before: row, ip });
}
