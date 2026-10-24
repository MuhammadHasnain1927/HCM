import { User } from '../models/User.js';
import { Settings } from '../models/Settings.js';
import { verifyPassword, fakeVerify, hashPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { AppError, badRequest, unauthorized } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

async function sessionPayload(user) {
  const settings = await Settings.get().select('companyName timezone').lean();
  return {
    token: signToken(user),
    user: user.toSafeJSON(),
    company: settings ? { name: settings.companyName, timezone: settings.timezone } : null,
  };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');

  // Same message for "no such user" and "wrong password" so emails cannot be guessed.
  if (!user) {
    await fakeVerify(password);
    throw unauthorized('Invalid email or password');
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid email or password');
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save();
  return sessionPayload(user);
}

export async function getMe(user) {
  const settings = await Settings.get().select('companyName timezone').lean();
  return {
    user: user.toSafeJSON(),
    company: settings ? { name: settings.companyName, timezone: settings.timezone } : null,
  };
}

export async function changePassword(user, { currentPassword, newPassword }, { ip } = {}) {
  const fresh = await User.findById(user._id).select('+passwordHash');
  if (!(await verifyPassword(currentPassword, fresh.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw badRequest('New password must be different from the current one');
  }

  fresh.passwordHash = await hashPassword(newPassword);
  fresh.mustChangePassword = false;
  fresh.tokenVersion += 1; // signs out other sessions
  await fresh.save();

  await recordAudit({ actor: fresh, action: 'user.change_password', entity: 'User', entityId: fresh._id, ip });
  return sessionPayload(fresh);
}
