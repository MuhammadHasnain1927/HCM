import { User, ROLES } from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';
import { AppError, forbidden, unauthorized } from '../utils/AppError.js';

function readBearer(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

async function authenticate(req, { allowPendingPasswordChange }) {
  const token = readBearer(req);
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Your session has expired, please sign in again');
  }

  // Re-read the user each request: deactivation, role changes and password
  // resets take effect immediately instead of waiting for the token to expire.
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.v) {
    throw unauthorized('Your session has expired, please sign in again');
  }
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  if (user.mustChangePassword && !allowPendingPasswordChange) {
    throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password first');
  }

  req.user = user;
}

/** Requires a valid session. Blocks accounts that still have a temporary password. */
export async function requireAuth(req, _res, next) {
  await authenticate(req, { allowPendingPasswordChange: false });
  next();
}

/** Like requireAuth, but lets a user with a temporary password through (for /me and change-password). */
export async function requireAuthAllowPending(req, _res, next) {
  await authenticate(req, { allowPendingPasswordChange: true });
  next();
}

/** Allows only the given roles. Use after requireAuth. */
export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!allowed.has(req.user.role)) throw forbidden();
    next();
  };
}

export const isManager = (user) => user.role === ROLES.ADMIN || user.role === ROLES.HR;

/**
 * Data scope (brief, Section 3, M1): Admin and HR see every row; an Employee
 * only sees rows with their own employee id. Every service that reads
 * employee data merges this into its query filter, and the AI tools call
 * those same services, so the AI gets the same limits.
 *
 *   Attendance.find({ ...employeeScope(req.user), date: today })
 */
export function employeeScope(user, field = 'employee') {
  if (isManager(user)) return {};
  if (!user.employee) throw forbidden('No employee record is linked to this account');
  return { [field]: user.employee };
}

/** Throws 403 unless the user may read the given employee's data. */
export function assertEmployeeAccess(user, employeeId) {
  if (isManager(user)) return;
  if (!user.employee || String(user.employee) !== String(employeeId)) throw forbidden();
}
