import { describe, expect, it } from 'vitest';
import { ADMIN, api, createUser, loginAs, setupCompany } from './helpers.js';
import { ROLES, User } from '../src/models/User.js';
import { Settings } from '../src/models/Settings.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { bootstrapFromEnv } from '../src/services/setup.service.js';

describe('first-run setup', () => {
  it('reports setup as not done on a fresh install', async () => {
    const res = await api().get('/api/setup/status').expect(200);
    expect(res.body).toEqual({ setupDone: false, companyName: null });
  });

  it('rejects invalid input with field details', async () => {
    const res = await api()
      .post('/api/setup')
      .send({ ...ADMIN, adminEmail: 'not-an-email', adminPassword: 'short' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toContain('adminEmail');
    expect(fields).toContain('adminPassword');
  });

  it('creates the company and Admin, signs the Admin in, and writes the audit log', async () => {
    const res = await api().post('/api/setup').send(ADMIN).expect(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({ email: ADMIN.adminEmail, role: 'admin', mustChangePassword: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.company.name).toBe(ADMIN.companyName);

    const status = await api().get('/api/setup/status').expect(200);
    expect(status.body).toEqual({ setupDone: true, companyName: ADMIN.companyName });

    const settings = await Settings.get();
    expect(settings).toMatchObject({ officeStart: '09:00', graceMinutes: 15, halfDayHours: 5 });
    expect([...settings.weekendDays].sort()).toEqual([0, 6]);

    const actions = (await AuditLog.find().lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.complete', 'user.create']));
  });

  it('only works once', async () => {
    await setupCompany();
    const res = await api()
      .post('/api/setup')
      .send({ ...ADMIN, adminEmail: 'second@acme.test' })
      .expect(409);
    expect(res.body.error.code).toBe('SETUP_DONE');
    expect(await User.countDocuments({ role: ROLES.ADMIN })).toBe(1);
  });

  it('recovers from a half-finished setup (company saved, Admin not created)', async () => {
    // Simulates a connection drop between saving the company and creating the Admin.
    await Settings.create({ companyName: 'Half Done Co' });
    const status = await api().get('/api/setup/status').expect(200);
    expect(status.body.setupDone).toBe(false);

    await api().post('/api/setup').send(ADMIN).expect(201);
    expect(await Settings.countDocuments()).toBe(1);
    expect((await Settings.get()).companyName).toBe(ADMIN.companyName);
    expect((await Settings.get()).setupCompletedAt).toBeInstanceOf(Date);
  });

  it('creates only one Admin when two setup requests race', async () => {
    const [a, b] = await Promise.all([
      api().post('/api/setup').send(ADMIN),
      api().post('/api/setup').send({ ...ADMIN, adminEmail: 'racer@acme.test' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ role: ROLES.ADMIN })).toBe(1);
  });

  it('stores passwords as bcrypt hashes, never plain text', async () => {
    await setupCompany();
    const admin = await User.findOne({ email: ADMIN.adminEmail }).select('+passwordHash');
    expect(admin.passwordHash).not.toBe(ADMIN.adminPassword);
    expect(admin.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('can bootstrap the Admin from env variables', async () => {
    const created = await bootstrapFromEnv(
      { ADMIN_EMAIL: 'env-admin@acme.test', ADMIN_PASSWORD: 'EnvAdmin123', COMPANY_NAME: 'Env Co' },
      { info() {} },
    );
    expect(created).toBe(true);
    expect(await User.exists({ email: 'env-admin@acme.test', role: 'admin' })).toBeTruthy();
    // Second start does nothing.
    expect(await bootstrapFromEnv({ ADMIN_EMAIL: 'x@acme.test', ADMIN_PASSWORD: 'Another123' })).toBe(false);
  });
});

describe('login and session', () => {
  it('logs in with correct credentials and returns the profile', async () => {
    await setupCompany();
    const res = await api()
      .post('/api/auth/login')
      .send({ email: 'ADMIN@acme.test', password: ADMIN.adminPassword })
      .expect(200);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body.user.email).toBe(ADMIN.adminEmail);
    expect(me.body.company.name).toBe(ADMIN.companyName);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await setupCompany();
    const wrongPw = await api().post('/api/auth/login').send({ email: ADMIN.adminEmail, password: 'Wrong12345' }).expect(401);
    const noUser = await api().post('/api/auth/login').send({ email: 'nobody@acme.test', password: 'Wrong12345' }).expect(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('rejects requests without a token, with a bad token, or with a tampered token', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const { token } = await setupCompany();
    const tampered = `${token.slice(0, -2)}xx`;
    await api().get('/api/auth/me').set('Authorization', `Bearer ${tampered}`).expect(401);
  });

  it('blocks deactivated accounts, including their existing sessions', async () => {
    await setupCompany();
    const user = await createUser({ role: ROLES.HR, email: 'hr@acme.test' });
    const token = await loginAs('hr@acme.test');
    await User.updateOne({ _id: user._id }, { isActive: false });

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(403);
    expect(me.body.error.code).toBe('ACCOUNT_DISABLED');
    const login = await api().post('/api/auth/login').send({ email: 'hr@acme.test', password: 'Passw0rd!' }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('temporary password flow', () => {
  it('forces a password change before anything else, then signs out old sessions', async () => {
    await setupCompany();
    await createUser({ role: ROLES.EMPLOYEE, email: 'emp@acme.test', password: 'Tmp-abc12345', mustChangePassword: true });
    const tempToken = await loginAs('emp@acme.test', 'Tmp-abc12345');

    // /me is allowed so the app can show the change-password screen.
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${tempToken}`).expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    // Wrong current password.
    await api()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: 'nope', newPassword: 'MyNewPass1' })
      .expect(400);

    // Weak new password.
    await api()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: 'Tmp-abc12345', newPassword: 'onlyletters' })
      .expect(400);

    const changed = await api()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: 'Tmp-abc12345', newPassword: 'MyNewPass1' })
      .expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    await api().get('/api/auth/me').set('Authorization', `Bearer ${tempToken}`).expect(401);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${changed.body.token}`).expect(200);
    await api().post('/api/auth/login').send({ email: 'emp@acme.test', password: 'MyNewPass1' }).expect(200);
  });
});

describe('audit log', () => {
  it('cannot be edited or deleted through the model', async () => {
    await setupCompany();
    const entry = await AuditLog.findOne();
    await expect(AuditLog.updateOne({ _id: entry._id }, { action: 'hacked' })).rejects.toThrow(/cannot be changed/);
    await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow(/cannot be changed/);
    entry.action = 'hacked';
    await expect(entry.save()).rejects.toThrow(/cannot be changed/);
  });
});

describe('api basics', () => {
  it('returns JSON 404 for unknown routes and a health check', async () => {
    const res = await api().get('/api/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await api().get('/api/health').expect(200);
  });
});
