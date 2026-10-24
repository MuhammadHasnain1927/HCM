import { parse as parseCsv } from 'csv-parse/sync';
import { Employee, salaryBreakdown } from '../models/Employee.js';
import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { User, ROLES } from '../models/User.js';
import { nextSequence } from '../models/Counter.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { escapeRegex, pageInfo } from '../utils/validators.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { inList } from '../utils/query.js';
import { assertEmployeeAccess, isManager } from '../middleware/auth.js';
import { recordAudit } from './audit.service.js';

// ---------- Serialization ----------

export function serializeEmployee(e, { includeSalary = true } = {}) {
  return {
    id: e._id.toString(),
    code: e.code,
    name: e.name,
    email: e.email,
    phone: e.phone,
    address: e.address,
    gender: e.gender,
    dateOfBirth: e.dateOfBirth,
    departmentId: e.department?._id ? e.department._id.toString() : e.department ? String(e.department) : null,
    departmentName: e.department?.name ?? null,
    designationId: e.designation?._id ? e.designation._id.toString() : e.designation ? String(e.designation) : null,
    designationTitle: e.designation?.title ?? null,
    joinDate: e.joinDate,
    exitDate: e.exitDate,
    exitReason: e.exitReason,
    status: e.status,
    faceEnrolledAt: e.faceEnrolledAt ?? null,
    ...(includeSalary ? { salary: { ...salaryBreakdown(e.salary?.basic), updatedAt: e.salary?.updatedAt ?? null } } : {}),
    userId: e.user ? String(e.user._id ?? e.user) : null,
    createdAt: e.createdAt,
  };
}

// Works on both queries and documents (document.populate returns a promise, not a chain).
const REFS = [
  { path: 'department', select: 'name' },
  { path: 'designation', select: 'title' },
];
const populateRefs = (queryOrDoc) => queryOrDoc.populate(REFS);

// ---------- Helpers ----------

async function generateCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = `EMP-${String(await nextSequence('employeeCode')).padStart(4, '0')}`;
    if (!(await Employee.exists({ code }))) return code;
  }
  throw new AppError(500, 'CODE_GENERATION_FAILED', 'Could not generate an employee code');
}

async function assertOrg({ departmentId, designationId }) {
  const dept = await Department.findById(departmentId).select('isActive name');
  if (!dept || !dept.isActive) {
    throw unprocessable('Pick an active department', 'INVALID_DEPARTMENT', [{ field: 'departmentId', message: 'Pick an active department' }]);
  }
  if (designationId) {
    const des = await Designation.findById(designationId).select('isActive department');
    if (!des || !des.isActive || String(des.department) !== String(departmentId)) {
      throw unprocessable('Designation does not belong to this department', 'INVALID_DESIGNATION', [
        { field: 'designationId', message: 'Pick a designation from the selected department' },
      ]);
    }
  }
}

async function loadEmployee(id) {
  const emp = await populateRefs(Employee.findById(id));
  if (!emp) throw notFound('Employee not found');
  return emp;
}

/**
 * Creates the login for a new employee. If an HR login with the same email
 * exists and is not linked yet (Admin created it before HR registered
 * themselves), it is linked instead so the person keeps one account.
 */
async function createOrLinkLogin(employee) {
  const existing = await User.findOne({ email: employee.email });
  if (existing) {
    if (existing.role === ROLES.HR && !existing.employee) {
      existing.employee = employee._id;
      await existing.save();
      return { user: existing, temporaryPassword: null, linkedExisting: true };
    }
    throw conflict('This email already has a login', 'EMAIL_IN_USE');
  }
  const temporaryPassword = generateTempPassword();
  const user = await User.create({
    name: employee.name,
    email: employee.email,
    passwordHash: await hashPassword(temporaryPassword),
    role: ROLES.EMPLOYEE,
    employee: employee._id,
    mustChangePassword: true,
  });
  return { user, temporaryPassword, linkedExisting: false };
}

// ---------- Register / read / update ----------

/** HR registers an employee; this creates the employee's login (brief, Section 3, M3). */
export async function registerEmployee(actor, data, { ip } = {}) {
  await assertOrg(data);
  if (await Employee.exists({ email: data.email })) throw conflict('An employee with this email already exists', 'DUPLICATE');
  const existingUser = await User.findOne({ email: data.email }).select('role employee');
  if (existingUser && !(existingUser.role === ROLES.HR && !existingUser.employee)) {
    throw conflict('This email already has a login', 'EMAIL_IN_USE');
  }
  if (data.code && (await Employee.exists({ code: data.code.toUpperCase() }))) {
    throw conflict(`Employee code ${data.code.toUpperCase()} is already in use`, 'DUPLICATE');
  }

  const employee = await Employee.create({
    code: data.code || (await generateCode()),
    name: data.name,
    email: data.email,
    phone: data.phone ?? '',
    address: data.address ?? '',
    gender: data.gender ?? null,
    dateOfBirth: data.dateOfBirth ?? null,
    department: data.departmentId,
    designation: data.designationId ?? null,
    joinDate: data.joinDate,
    status: data.status ?? 'active',
    salary: { basic: data.basicSalary, updatedAt: new Date() },
    createdBy: actor._id,
  });

  let login;
  try {
    login = await createOrLinkLogin(employee);
  } catch (err) {
    await Employee.deleteOne({ _id: employee._id });
    throw err;
  }
  employee.user = login.user._id;
  await employee.save();

  await recordAudit({ actor, action: 'employee.create', entity: 'Employee', entityId: employee._id, after: employee, ip });
  await populateRefs(employee);
  return {
    employee: serializeEmployee(employee),
    login: { email: login.user.email, role: login.user.role, temporaryPassword: login.temporaryPassword, linkedExisting: login.linkedExisting },
  };
}

function buildFilter({ search, departmentId, designationId, status }) {
  const filter = {};
  if (departmentId) filter.department = departmentId;
  if (designationId) filter.designation = designationId;
  if (status === 'current') filter.status = inList(['active', 'probation']);
  else if (status) filter.status = status;
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: re }, { email: re }, { code: re }, { phone: re }];
  }
  return filter;
}

const SORTS = {
  name: { name: 1 },
  code: { code: 1 },
  joinDate: { joinDate: -1 },
  newest: { createdAt: -1 },
};

/** Server-side search, filters and paging (Admin and HR). */
export async function listEmployees(query) {
  const { page, limit, sort = 'name' } = query;
  const filter = buildFilter(query);
  const [rows, total] = await Promise.all([
    populateRefs(Employee.find(filter))
      .collation({ locale: 'en' })
      .sort(SORTS[sort] ?? SORTS.name)
      .skip((page - 1) * limit)
      .limit(limit),
    Employee.countDocuments(filter),
  ]);
  return { items: rows.map((e) => serializeEmployee(e)), ...pageInfo({ page, limit }, total) };
}

export async function getEmployee(user, id) {
  assertEmployeeAccess(user, id);
  return serializeEmployee(await loadEmployee(id));
}

export async function getMyEmployee(user) {
  if (!user.employee) throw notFound('No employee record is linked to your account');
  return serializeEmployee(await loadEmployee(user.employee));
}

/** HR edits job and personal details. Exiting goes through exitEmployee. */
function assertNotSelf(actor, emp, what) {
  if (emp.user && String(emp.user) === String(actor._id)) throw forbidden(`You cannot change your own ${what}. Ask another HR member.`);
}

export async function updateEmployee(actor, id, changes, { ip } = {}) {
  const emp = await loadEmployee(id);
  assertNotSelf(actor, emp, 'employee record');
  const before = emp.toObject();

  const departmentId = changes.departmentId ?? String(emp.department._id);
  const designationId = changes.designationId !== undefined ? changes.designationId : emp.designation ? String(emp.designation._id) : null;
  if (changes.departmentId !== undefined || changes.designationId !== undefined) {
    await assertOrg({ departmentId, designationId });
  }

  if (changes.email && changes.email !== emp.email) {
    if (await Employee.exists({ email: changes.email })) throw conflict('An employee with this email already exists', 'DUPLICATE');
    if (await User.exists({ email: changes.email })) throw conflict('This email already has a login', 'EMAIL_IN_USE');
  }
  if (changes.code && changes.code.toUpperCase() !== emp.code && (await Employee.exists({ code: changes.code.toUpperCase() }))) {
    throw conflict(`Employee code ${changes.code.toUpperCase()} is already in use`, 'DUPLICATE');
  }

  const reinstating = emp.status === 'exited' && changes.status && changes.status !== 'exited';
  emp.set({
    ...(changes.code !== undefined ? { code: changes.code } : {}),
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.email !== undefined ? { email: changes.email } : {}),
    ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
    ...(changes.address !== undefined ? { address: changes.address } : {}),
    ...(changes.gender !== undefined ? { gender: changes.gender } : {}),
    ...(changes.dateOfBirth !== undefined ? { dateOfBirth: changes.dateOfBirth } : {}),
    ...(changes.joinDate !== undefined ? { joinDate: changes.joinDate } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    department: departmentId,
    designation: designationId,
    ...(reinstating ? { exitDate: null, exitReason: '' } : {}),
  });
  await emp.save();

  // Keep the login in step with the record.
  if (emp.user) {
    const userChanges = {};
    if (changes.name !== undefined) userChanges.name = emp.name;
    if (changes.email !== undefined) userChanges.email = emp.email;
    if (reinstating) userChanges.isActive = true;
    if (Object.keys(userChanges).length) await User.updateOne({ _id: emp.user }, userChanges);
  }

  await recordAudit({ actor, action: reinstating ? 'employee.reinstate' : 'employee.update', entity: 'Employee', entityId: emp._id, before, after: emp, ip });
  await populateRefs(emp);
  return serializeEmployee(emp);
}

/** HR sets the salary structure (brief #14). */
export async function updateSalary(actor, id, { basic }, { ip } = {}) {
  const emp = await loadEmployee(id);
  assertNotSelf(actor, emp, 'salary');
  if (emp.status === 'exited') throw unprocessable('Reinstate the employee before changing their salary', 'EMPLOYEE_EXITED');
  const before = { salary: salaryBreakdown(emp.salary?.basic) };
  emp.salary = { basic, updatedAt: new Date() };
  await emp.save();
  await recordAudit({ actor, action: 'employee.salary_update', entity: 'Employee', entityId: emp._id, before, after: { salary: salaryBreakdown(basic) }, ip });
  return serializeEmployee(emp);
}

/** Marks an employee as having left; their login is deactivated (attrition counts exits). */
export async function exitEmployee(actor, id, { exitDate, reason }, { ip } = {}) {
  const emp = await loadEmployee(id);
  if (emp.status === 'exited') throw unprocessable('This employee has already exited', 'ALREADY_EXITED');
  if (exitDate < emp.joinDate) throw unprocessable('Exit date cannot be before the join date', 'INVALID_DATE', [{ field: 'exitDate', message: 'Must be on or after the join date' }]);
  if (emp.user && String(emp.user) === String(actor._id)) throw forbidden('You cannot exit yourself');

  const before = emp.toObject();
  emp.set({ status: 'exited', exitDate, exitReason: reason ?? '' });
  await emp.save();
  if (emp.user) {
    await User.updateOne({ _id: emp.user }, { isActive: false, $inc: { tokenVersion: 1 } });
  }
  await recordAudit({ actor, action: 'employee.exit', entity: 'Employee', entityId: emp._id, before, after: emp, ip });
  await populateRefs(emp);
  return serializeEmployee(emp);
}

/** Employees may edit only their phone and address (brief, Section 2). */
export async function updateMyProfile(user, { phone, address }, { ip } = {}) {
  if (!user.employee) throw notFound('No employee record is linked to your account');
  const emp = await loadEmployee(user.employee);
  const before = { phone: emp.phone, address: emp.address };
  if (phone !== undefined) emp.phone = phone;
  if (address !== undefined) emp.address = address;
  await emp.save();
  await recordAudit({ actor: user, action: 'employee.self_update', entity: 'Employee', entityId: emp._id, before, after: { phone: emp.phone, address: emp.address }, ip });
  return serializeEmployee(emp);
}

/** Searches employees for the AI assistant and pickers, scoped to the caller. */
export async function searchEmployees(user, { query, limit = 10 }) {
  if (!isManager(user)) {
    // Employees can only "find" themselves.
    if (!user.employee) return [];
    const me = await loadEmployee(user.employee);
    return [serializeEmployee(me)];
  }
  const res = await listEmployees({ search: query, page: 1, limit });
  return res.items;
}

// ---------- CSV export ----------

const CSV_COLUMNS = [
  ['code', (e) => e.code],
  ['name', (e) => e.name],
  ['email', (e) => e.email],
  ['phone', (e) => e.phone],
  ['gender', (e) => e.gender ?? ''],
  ['department', (e) => e.departmentName ?? ''],
  ['designation', (e) => e.designationTitle ?? ''],
  ['joinDate', (e) => e.joinDate],
  ['status', (e) => e.status],
  ['basicSalary', (e) => e.salary.basic],
  ['grossSalary', (e) => e.salary.gross],
  ['exitDate', (e) => e.exitDate ?? ''],
  ['address', (e) => e.address],
];

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when needed; prefix formula-like values so spreadsheets do not execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportEmployeesCsv(query) {
  const rows = await populateRefs(Employee.find(buildFilter(query))).collation({ locale: 'en' }).sort({ name: 1 });
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  for (const row of rows) {
    const e = serializeEmployee(row);
    lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(e))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- CSV import with dry run (brief, Section 3, M3) ----------

const MAX_IMPORT_ROWS = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function normalizeHeader(h) {
  const key = String(h).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const map = {
    code: 'code', employeecode: 'code', empcode: 'code',
    name: 'name', fullname: 'name',
    email: 'email', emailaddress: 'email',
    phone: 'phone', mobile: 'phone',
    gender: 'gender',
    department: 'department', dept: 'department',
    designation: 'designation', title: 'designation', jobtitle: 'designation',
    joindate: 'joinDate', joiningdate: 'joinDate', datejoined: 'joinDate',
    basicsalary: 'basicSalary', basic: 'basicSalary', salary: 'basicSalary',
    status: 'status',
    address: 'address',
    dateofbirth: 'dateOfBirth', dob: 'dateOfBirth',
  };
  return map[key] ?? null;
}

/**
 * Validates every row and reports problems as { row, field, reason }.
 * With dryRun=false and no errors, all rows are imported (all or nothing).
 */
export async function importEmployeesCsv(actor, csvText, { dryRun = true, ip } = {}) {
  let records;
  try {
    records = parseCsv(csvText, { bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (err) {
    throw unprocessable(`The file is not valid CSV: ${err.message}`, 'INVALID_CSV');
  }
  if (records.length < 2) throw unprocessable('The file has no data rows', 'INVALID_CSV');

  const headers = records[0].map(normalizeHeader);
  for (const required of ['name', 'email', 'department', 'joinDate', 'basicSalary']) {
    if (!headers.includes(required)) {
      throw unprocessable(`Missing column "${required}"`, 'INVALID_CSV', [{ row: 1, field: required, reason: 'Column is missing from the header row' }]);
    }
  }
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) throw unprocessable(`Import at most ${MAX_IMPORT_ROWS} rows at a time`, 'INVALID_CSV');

  const [departments, designations] = await Promise.all([
    Department.find({ isActive: true }).lean(),
    Designation.find({ isActive: true }).lean(),
  ]);
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));

  const rows = dataRows.map((cells, i) => {
    const obj = { _line: i + 2 };
    headers.forEach((h, idx) => {
      if (h) obj[h] = (cells[idx] ?? '').trim();
    });
    return obj;
  });

  const emails = rows.map((r) => (r.email || '').toLowerCase()).filter(Boolean);
  const codes = rows.map((r) => (r.code || '').toUpperCase()).filter(Boolean);
  const [existingEmails, existingUserEmails, existingCodes] = await Promise.all([
    Employee.find({ email: inList(emails) }).distinct('email'),
    User.find({ email: inList(emails) }).distinct('email'),
    Employee.find({ code: inList(codes) }).distinct('code'),
  ]);
  const takenEmails = new Set([...existingEmails, ...existingUserEmails]);
  const takenCodes = new Set(existingCodes);

  const errors = [];
  const seenEmails = new Map();
  const seenCodes = new Map();
  const valid = [];

  for (const r of rows) {
    const rowErrors = [];
    const add = (field, reason) => rowErrors.push({ row: r._line, field, reason });

    if (!r.name) add('name', 'Name is required');
    const email = (r.email || '').toLowerCase();
    if (!email) add('email', 'Email is required');
    else if (!EMAIL_RE.test(email)) add('email', 'Not a valid email');
    else if (takenEmails.has(email)) add('email', 'Email already exists in the system');
    else if (seenEmails.has(email)) add('email', `Duplicate of row ${seenEmails.get(email)}`);
    else seenEmails.set(email, r._line);

    const code = (r.code || '').toUpperCase();
    if (code) {
      if (!/^[A-Z0-9-]{2,20}$/.test(code)) add('code', 'Use 2-20 letters, digits or dashes');
      else if (takenCodes.has(code)) add('code', 'Code already exists in the system');
      else if (seenCodes.has(code)) add('code', `Duplicate of row ${seenCodes.get(code)}`);
      else seenCodes.set(code, r._line);
    }

    const dept = r.department ? deptByName.get(r.department.toLowerCase()) : null;
    if (!r.department) add('department', 'Department is required');
    else if (!dept) add('department', `Unknown department "${r.department}"`);

    let designation = null;
    if (r.designation && dept) {
      designation = designations.find((d) => String(d.department) === String(dept._id) && d.title.toLowerCase() === r.designation.toLowerCase());
      if (!designation) add('designation', `Unknown designation "${r.designation}" in ${dept.name}`);
    }

    if (!r.joinDate) add('joinDate', 'Join date is required');
    else if (!isIsoDate(r.joinDate)) add('joinDate', 'Use an ISO date like 2026-01-15');

    const salary = Number(r.basicSalary);
    if (r.basicSalary === undefined || r.basicSalary === '') add('basicSalary', 'Basic salary is required');
    else if (!Number.isFinite(salary) || salary <= 0) add('basicSalary', 'Salary must be a number greater than 0');

    const status = (r.status || 'active').toLowerCase();
    if (!['active', 'probation'].includes(status)) add('status', 'Use active or probation');

    const gender = r.gender ? r.gender.toLowerCase() : null;
    if (gender && !['male', 'female', 'other'].includes(gender)) add('gender', 'Use male, female or other');
    if (r.dateOfBirth && !isIsoDate(r.dateOfBirth)) add('dateOfBirth', 'Use an ISO date like 1995-06-30');

    if (rowErrors.length) errors.push(...rowErrors);
    else {
      valid.push({
        code: code || null,
        name: r.name,
        email,
        phone: r.phone ?? '',
        address: r.address ?? '',
        gender,
        dateOfBirth: r.dateOfBirth || null,
        departmentId: String(dept._id),
        designationId: designation ? String(designation._id) : null,
        joinDate: r.joinDate,
        basicSalary: salary,
        status,
      });
    }
  }

  const summary = { totalRows: rows.length, validRows: valid.length, errorCount: errors.length, errors };
  if (dryRun || errors.length) return { ...summary, imported: 0, dryRun: true };

  // Rows with their own code go first so a generated code can never take a code a later row asks for.
  const ordered = [...valid.filter((r) => r.code), ...valid.filter((r) => !r.code)];
  const created = [];
  let failure = null;
  for (const row of ordered) {
    try {
      const res = await registerEmployee(actor, row, { ip });
      created.push({ code: res.employee.code, name: res.employee.name, email: res.login.email, temporaryPassword: res.login.temporaryPassword });
    } catch (err) {
      // Stop, but never lose the passwords of rows already created.
      failure = { email: row.email, reason: err.message };
      break;
    }
  }
  await recordAudit({ actor, action: 'employee.import', entity: 'Employee', after: { imported: created.length, failure }, ip });
  return { ...summary, dryRun: false, imported: created.length, credentials: created, ...(failure ? { stoppedAt: failure } : {}) };
}
