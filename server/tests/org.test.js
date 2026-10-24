import { describe, expect, it } from 'vitest';
import { api, as, setupWithRoles } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';

describe('company settings', () => {
  it('lets Admin and HR read, Employee not', async () => {
    const t = await setupWithRoles();
    const res = await as(t.admin).get('/api/settings').expect(200);
    expect(res.body).toMatchObject({
      companyName: 'Acme Pvt Ltd',
      officeStart: '09:00',
      graceMinutes: 15,
      halfDayHours: 5,
      weekendDays: [0, 6],
      office: { lat: null, lng: null, radiusMeters: 150 },
    });
    await as(t.hr).get('/api/settings').expect(200);
    await as(t.employee).get('/api/settings').expect(403);
    await api().get('/api/settings').expect(401);
  });

  it('only Admin can change settings, and the change is audited', async () => {
    const t = await setupWithRoles();
    const change = { officeStart: '10:00', officeEnd: '19:00', graceMinutes: 10, office: { lat: 24.8607, lng: 67.0011, radiusMeters: 200 } };
    await as(t.hr).put('/api/settings', change).expect(403);
    const res = await as(t.admin).put('/api/settings', change).expect(200);
    expect(res.body).toMatchObject({ officeStart: '10:00', graceMinutes: 10, office: { lat: 24.8607, lng: 67.0011, radiusMeters: 200 } });

    const audit = await AuditLog.findOne({ action: 'settings.update' }).lean();
    expect(audit.before.officeStart).toBe('09:00');
    expect(audit.after.officeStart).toBe('10:00');
  });

  it('rejects invalid values and inconsistent combinations', async () => {
    const t = await setupWithRoles();
    await as(t.admin).put('/api/settings', { officeStart: '9am' }).expect(400);
    await as(t.admin).put('/api/settings', { office: { radiusMeters: 1 } }).expect(400);
    await as(t.admin).put('/api/settings', { timezone: 'Mars/Olympus' }).expect(400);

    const endBeforeStart = await as(t.admin).put('/api/settings', { officeStart: '18:00', officeEnd: '09:00' }).expect(422);
    expect(endBeforeStart.body.error.code).toBe('INVALID_SETTINGS');
    await as(t.admin).put('/api/settings', { weekendDays: [0, 1, 2, 3, 4, 5, 6] }).expect(400);
    await as(t.admin).put('/api/settings', { office: { lat: 24.86 } }).expect(422);
    await as(t.admin).put('/api/settings', { halfDayHours: 9 }).expect(422);
  });
});

describe('departments and designations', () => {
  it('creates, lists, renames and archives departments (Admin only)', async () => {
    const t = await setupWithRoles();
    await as(t.hr).post('/api/org/departments', { name: 'Sales' }).expect(403);

    const sales = (await as(t.admin).post('/api/org/departments', { name: 'Sales' }).expect(201)).body;
    await as(t.admin).post('/api/org/departments', { name: 'Engineering', description: 'Builds things' }).expect(201);

    const list = (await as(t.hr).get('/api/org/departments').expect(200)).body;
    expect(list.map((d) => d.name)).toEqual(['Engineering', 'Sales']);

    await as(t.admin).patch(`/api/org/departments/${sales.id}`, { name: 'Sales & Marketing' }).expect(200);
    await as(t.admin).patch(`/api/org/departments/${sales.id}`, { isActive: false }).expect(200);
    expect((await as(t.admin).get('/api/org/departments').expect(200)).body).toHaveLength(1);
    expect((await as(t.admin).get('/api/org/departments?includeArchived=true').expect(200)).body).toHaveLength(2);
  });

  it('treats department names case-insensitively for duplicates', async () => {
    const t = await setupWithRoles();
    await as(t.admin).post('/api/org/departments', { name: 'Sales' }).expect(201);
    const dup = await as(t.admin).post('/api/org/departments', { name: 'SALES' }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('ties designations to an active department', async () => {
    const t = await setupWithRoles();
    const itDept = (await as(t.admin).post('/api/org/departments', { name: 'IT' }).expect(201)).body;
    const sales = (await as(t.admin).post('/api/org/departments', { name: 'Sales' }).expect(201)).body;

    const dev = (await as(t.admin).post('/api/org/designations', { title: 'Developer', departmentId: itDept.id }).expect(201)).body;
    expect(dev).toMatchObject({ title: 'Developer', departmentName: 'IT' });

    // Same title in another department is fine; same title in the same department is not.
    await as(t.admin).post('/api/org/designations', { title: 'Manager', departmentId: itDept.id }).expect(201);
    await as(t.admin).post('/api/org/designations', { title: 'Manager', departmentId: sales.id }).expect(201);
    await as(t.admin).post('/api/org/designations', { title: 'manager', departmentId: itDept.id }).expect(409);

    const forIt = (await as(t.hr).get(`/api/org/designations?departmentId=${itDept.id}`).expect(200)).body;
    expect(forIt.map((d) => d.title)).toEqual(['Developer', 'Manager']);

    await as(t.admin).patch(`/api/org/departments/${sales.id}`, { isActive: false }).expect(200);
    const archived = await as(t.admin).post('/api/org/designations', { title: 'Rep', departmentId: sales.id }).expect(422);
    expect(archived.body.error.code).toBe('INVALID_DEPARTMENT');
    await as(t.admin).post('/api/org/designations', { title: 'Rep', departmentId: 'not-an-id' }).expect(400);

    const depts = (await as(t.admin).get('/api/org/departments').expect(200)).body;
    expect(depts.find((d) => d.name === 'IT').designationCount).toBe(2);
  });
});

describe('leave types', () => {
  it('creates the brief\'s built-in leave types at setup', async () => {
    const t = await setupWithRoles();
    const types = (await as(t.hr).get('/api/org/leave-types').expect(200)).body;
    const byCode = Object.fromEntries(types.map((x) => [x.code, x]));
    expect(byCode.annual).toMatchObject({ yearlyQuota: 14, isPaid: true, isSystem: true });
    expect(byCode.sick).toMatchObject({ yearlyQuota: 8, isPaid: true });
    expect(byCode.casual).toMatchObject({ yearlyQuota: 10, isPaid: true });
    expect(byCode.unpaid).toMatchObject({ yearlyQuota: null, isPaid: false });
  });

  it('lets Admin change quotas and add custom types, but protects built-in rules', async () => {
    const t = await setupWithRoles();
    const types = (await as(t.admin).get('/api/org/leave-types').expect(200)).body;
    const annual = types.find((x) => x.code === 'annual');
    const unpaid = types.find((x) => x.code === 'unpaid');

    expect((await as(t.admin).patch(`/api/org/leave-types/${annual.id}`, { yearlyQuota: 16 }).expect(200)).body.yearlyQuota).toBe(16);
    await as(t.hr).patch(`/api/org/leave-types/${annual.id}`, { yearlyQuota: 30 }).expect(403);
    await as(t.admin).patch(`/api/org/leave-types/${annual.id}`, { isActive: false }).expect(422);
    await as(t.admin).patch(`/api/org/leave-types/${annual.id}`, { isPaid: false }).expect(422);
    await as(t.admin).patch(`/api/org/leave-types/${unpaid.id}`, { yearlyQuota: 5 }).expect(422);

    const maternity = (await as(t.admin).post('/api/org/leave-types', { name: 'Maternity leave', yearlyQuota: 90, isPaid: true }).expect(201)).body;
    expect(maternity).toMatchObject({ code: 'maternity_leave', isSystem: false });
    await as(t.admin).patch(`/api/org/leave-types/${maternity.id}`, { isActive: false }).expect(200);
    await as(t.admin).post('/api/org/leave-types', { name: 'annual leave', yearlyQuota: 1 }).expect(409);
  });
});

describe('holidays', () => {
  it('adds, lists by year, edits and deletes holidays', async () => {
    const t = await setupWithRoles();
    await as(t.hr).post('/api/org/holidays', { date: '2026-12-25', name: 'Quaid Day' }).expect(403);

    const quaid = (await as(t.admin).post('/api/org/holidays', { date: '2026-12-25', name: 'Quaid Day' }).expect(201)).body;
    await as(t.admin).post('/api/org/holidays', { date: '2027-02-05', name: 'Kashmir Day' }).expect(201);

    expect((await as(t.hr).get('/api/org/holidays?year=2026').expect(200)).body).toEqual([
      { id: quaid.id, date: '2026-12-25', name: 'Quaid Day' },
    ]);

    const dup = await as(t.admin).post('/api/org/holidays', { date: '2026-12-25', name: 'Christmas' }).expect(409);
    expect(dup.body.error.message).toContain('2026-12-25');

    await as(t.admin).post('/api/org/holidays', { date: '2026-02-30', name: 'Not real' }).expect(400);
    await as(t.admin).post('/api/org/holidays', { date: '25/12/2026', name: 'Wrong format' }).expect(400);

    await as(t.admin).patch(`/api/org/holidays/${quaid.id}`, { name: 'Quaid-e-Azam Day' }).expect(200);
    await as(t.admin).delete(`/api/org/holidays/${quaid.id}`).expect(204);
    await as(t.admin).delete(`/api/org/holidays/${quaid.id}`).expect(404);
    expect(await AuditLog.countDocuments({ action: /^holiday\./ })).toBe(4);
  });
});
