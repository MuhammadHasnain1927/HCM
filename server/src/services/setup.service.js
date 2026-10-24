import { Settings } from '../models/Settings.js';
import { User, ROLES } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { conflict } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

// Setup is "done" only once the owner Admin exists. A company record without an
// Admin (e.g. the connection dropped half-way) does not lock anyone out: setup
// simply runs again and overwrites it.
const ownerExists = () => User.exists({ isOwner: true });

export async function getSetupStatus() {
  const [owner, settings] = await Promise.all([ownerExists(), Settings.get().select('companyName').lean()]);
  return {
    setupDone: Boolean(owner),
    companyName: owner ? (settings?.companyName ?? null) : null,
  };
}

/**
 * First-run setup: creates the company settings and the first (owner) Admin.
 * Allowed exactly once; the unique index on User.isOwner makes concurrent
 * requests safe without needing a transaction.
 */
export async function completeSetup({ companyName, timezone, adminName, adminEmail, adminPassword }, { ip } = {}) {
  if (await ownerExists()) throw conflict('Setup has already been completed', 'SETUP_DONE');

  const settings = await Settings.findOneAndUpdate(
    { key: 'company' },
    { $set: { companyName, ...(timezone ? { timezone } : {}) } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  );

  let admin;
  try {
    admin = await User.create({
      name: adminName,
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: ROLES.ADMIN,
      isOwner: true,
      mustChangePassword: false,
    });
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.isOwner) {
      throw conflict('Setup has already been completed', 'SETUP_DONE');
    }
    throw err;
  }

  settings.setupCompletedAt = new Date();
  await settings.save();

  await recordAudit({ actor: admin, action: 'setup.complete', entity: 'Settings', entityId: settings._id, after: settings, ip });
  await recordAudit({ actor: admin, action: 'user.create', entity: 'User', entityId: admin._id, after: admin, ip });

  return { settings, admin };
}

/**
 * Optional bootstrap from env (ADMIN_EMAIL / ADMIN_PASSWORD), run at server start.
 * Does nothing if setup is already done or the variables are not set.
 */
export async function bootstrapFromEnv(env, logger = console) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return false;
  if (await ownerExists()) return false;

  await completeSetup({
    companyName: env.COMPANY_NAME || 'My Company',
    adminName: env.ADMIN_NAME || 'Administrator',
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
  });
  logger.info?.(`First-run setup completed from env for ${env.ADMIN_EMAIL}`);
  return true;
}
