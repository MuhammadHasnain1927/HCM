import { describe, expect, it } from 'vitest';
import { ADMIN, api, as, setupWithRoles } from './helpers.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';

describe('HR user accounts (Admin only)', () => {
  it('creates an HR login with a temporary password that must be changed', async () => {
    const t = await setupWithRoles();
    const res = await as(t.admin).post('/api/users/hr', { name: 'Hina HR', email: 'Hina@Acme.test' }).expect(201);
    expect(res.body.user).toMatchObject({ name: 'Hina HR', email: 'hina@acme.test', role: 'hr', mustChangePassword: true });
    expect(res.body.temporaryPassword).toMatch(/^Tmp-/);

    // The temporary password works once, and only for changing it.
    const login = await api().post('/api/auth/login').send({ email: 'hina@acme.test', password: res.body.temporaryPassword }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const blocked = await as(login.body.token).get('/api/settings').expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const stored = await User.findOne({ email: 'hina@acme.test' }).select('+passwordHash');
    expect(stored.passwordHash).not.toContain(res.body.temporaryPassword);
  });

  it('refuses duplicates and non-Admin callers', async () => {
    const t = await setupWithRoles();
    await as(t.admin).post('/api/users/hr', { name: 'Hina HR', email: 'hina@acme.test' }).expect(201);
    await as(t.admin).post('/api/users/hr', { name: 'Other', email: 'HINA@acme.test' }).expect(409);
    await as(t.hr).post('/api/users/hr', { name: 'Sneaky', email: 'sneaky@acme.test' }).expect(403);
    await as(t.employee).get('/api/users').expect(403);
  });

  it('lists accounts with search, role filter and paging', async () => {
    const t = await setupWithRoles();
    const all = (await as(t.admin).get('/api/users').expect(200)).body;
    expect(all.total).toBe(3);
    expect(all.items[0]).toMatchObject({ email: ADMIN.adminEmail, isOwner: true });

    const hrOnly = (await as(t.admin).get('/api/users?role=hr').expect(200)).body;
    expect(hrOnly.items.map((u) => u.email)).toEqual(['hr@acme.test']);

    const search = (await as(t.admin).get('/api/users?search=emp%40').expect(200)).body;
    expect(search.items.map((u) => u.email)).toEqual(['emp@acme.test']);

    // Regex characters in search are treated as plain text.
    expect((await as(t.admin).get('/api/users?search=.*').expect(200)).body.total).toBe(0);

    const paged = (await as(t.admin).get('/api/users?limit=2&page=2').expect(200)).body;
    expect(paged).toMatchObject({ page: 2, limit: 2, total: 3, pages: 2 });
    expect(paged.items).toHaveLength(1);
  });

  it('deactivates and reactivates accounts, signing out the user immediately', async () => {
    const t = await setupWithRoles();
    const hr = await User.findOne({ email: 'hr@acme.test' });

    await as(t.admin).patch(`/api/users/${hr.id}/status`, { isActive: false }).expect(200);
    await as(t.hr).get('/api/settings').expect(401);
    const login = await api().post('/api/auth/login').send({ email: 'hr@acme.test', password: 'Passw0rd!' }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');

    await as(t.admin).patch(`/api/users/${hr.id}/status`, { isActive: true }).expect(200);
    await api().post('/api/auth/login').send({ email: 'hr@acme.test', password: 'Passw0rd!' }).expect(200);
    expect(await AuditLog.countDocuments({ action: /^user.(de)?activate$/ })).toBe(2);
  });

  it('resets a password to a new temporary one and ends old sessions', async () => {
    const t = await setupWithRoles();
    const emp = await User.findOne({ email: 'emp@acme.test' });
    const res = await as(t.admin).post(`/api/users/${emp.id}/reset-password`).expect(200);

    await as(t.employee).get('/api/auth/me').expect(401);
    await api().post('/api/auth/login').send({ email: 'emp@acme.test', password: 'Passw0rd!' }).expect(401);
    const login = await api().post('/api/auth/login').send({ email: 'emp@acme.test', password: res.body.temporaryPassword }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('protects the Admin account from these actions', async () => {
    const t = await setupWithRoles();
    const admin = await User.findOne({ email: ADMIN.adminEmail });
    const self = await as(t.admin).patch(`/api/users/${admin.id}/status`, { isActive: false }).expect(422);
    expect(self.body.error.code).toBe('SELF_ACTION');
    await as(t.admin).post(`/api/users/${admin.id}/reset-password`).expect(422);
    await as(t.admin).patch('/api/users/64b000000000000000000000/status', { isActive: false }).expect(404);
    await as(t.admin).patch('/api/users/not-an-id/status', { isActive: false }).expect(400);
  });
});
