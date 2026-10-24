import { User, ROLES } from '../models/User.js';
import { forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { escapeRegex, pageInfo } from '../utils/validators.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { recordAudit } from './audit.service.js';

const serializeUser = (u) => ({
  id: u._id.toString(),
  name: u.name,
  email: u.email,
  role: u.role,
  isOwner: Boolean(u.isOwner),
  employeeId: u.employee ? u.employee.toString() : null,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

export async function listUsers({ role, status, search, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.isActive = status === 'active';
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort({ isOwner: -1, role: 1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return { items: rows.map(serializeUser), ...pageInfo({ page, limit }, total) };
}

/**
 * Admin creates an HR login. The temporary password is returned once so the
 * Admin can hand it over; it is never stored in plain text.
 */
export async function createHrUser(actor, { name, email }, { ip } = {}) {
  const temporaryPassword = generateTempPassword();
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(temporaryPassword),
    role: ROLES.HR,
    mustChangePassword: true,
  });
  await recordAudit({ actor, action: 'user.create', entity: 'User', entityId: user._id, after: user, ip });
  return { user: serializeUser(user), temporaryPassword };
}

async function loadManagedUser(actor, id) {
  const user = await User.findById(id);
  if (!user) throw notFound('User not found');
  if (String(user._id) === String(actor._id)) {
    throw unprocessable('You cannot change your own account here. Use Change password instead.', 'SELF_ACTION');
  }
  if (user.isOwner || user.role === ROLES.ADMIN) throw forbidden('Admin accounts cannot be changed here');
  return user;
}

export async function setUserActive(actor, id, isActive, { ip } = {}) {
  const user = await loadManagedUser(actor, id);
  if (user.isActive === isActive) return serializeUser(user);
  const before = user.toObject();
  user.isActive = isActive;
  if (!isActive) user.tokenVersion += 1; // sign out everywhere immediately
  await user.save();
  await recordAudit({
    actor,
    action: isActive ? 'user.activate' : 'user.deactivate',
    entity: 'User',
    entityId: user._id,
    before,
    after: user,
    ip,
  });
  return serializeUser(user);
}

/**
 * Switches an employee-linked login between Employee and HR (e.g. an employee
 * moves into the HR team). Admin accounts are never created this way.
 */
export async function setUserRole(actor, id, role, { ip } = {}) {
  const user = await loadManagedUser(actor, id);
  if (user.role === role) return serializeUser(user);
  if (role === ROLES.EMPLOYEE && !user.employee) {
    throw unprocessable('This login has no employee record, so it cannot become an Employee login', 'NO_EMPLOYEE_RECORD');
  }
  const before = user.toObject();
  user.role = role;
  user.tokenVersion += 1; // new permissions on next sign-in
  await user.save();
  await recordAudit({ actor, action: 'user.role_change', entity: 'User', entityId: user._id, before, after: user, ip });
  return serializeUser(user);
}

export async function resetUserPassword(actor, id, { ip } = {}) {
  const user = await loadManagedUser(actor, id);
  const temporaryPassword = generateTempPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  user.tokenVersion += 1;
  await user.save();
  await recordAudit({ actor, action: 'user.reset_password', entity: 'User', entityId: user._id, ip });
  return { user: serializeUser(user), temporaryPassword };
}
