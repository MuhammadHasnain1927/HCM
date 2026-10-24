import { describe, expect, it } from 'vitest';
import { api, as, createOrg, createUser, loginAs, registerEmployee, setupWithRoles } from './helpers.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';

describe('register employees', () => {
  it('creates the employee and a login with a temporary password', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const res = await as(t.hr)
      .post('/api/employees', {
        name: 'Sara Ahmed',
        email: 'Sara@Acme.test',
        departmentId: org.departmentId,
        designationId: org.designationId,
        joinDate: '2026-02-01',
        basicSalary: 120000,
        gender: 'female',
      })
      .expect(201);

    expect(res.body.employee).toMatchObject({
      code: 'EMP-0001',
      email: 'sara@acme.test',
      departmentName: 'Engineering',
      designationTitle: 'Developer',
      status: 'active',
      salary: { basic: 120000, hra: 48000, medical: 12000, gross: 180000 },
    });
    expect(res.body.login).toMatchObject({ email: 'sara@acme.test', role: 'employee', linkedExisting: false });

    const login = await api().post('/api/auth/login').send({ email: 'sara@acme.test', password: res.body.login.temporaryPassword }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    expect(login.body.user.employeeId).toBe(res.body.employee.id);

    const second = await as(t.hr)
      .post('/api/employees', { name: 'Bilal', email: 'bilal@acme.test', departmentId: org.departmentId, joinDate: '2026-02-01', basicSalary: 90000 })
      .expect(201);
    expect(second.body.employee.code).toBe('EMP-0002');
    expect(await AuditLog.countDocuments({ action: 'employee.create' })).toBe(2);
  });

  it('only HR registers; Admin views; Employee cannot list', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const body = { name: 'X Y', email: 'xy@acme.test', departmentId: org.departmentId, joinDate: '2026-01-01', basicSalary: 1000 };
    await as(t.admin).post('/api/employees', body).expect(403);
    await as(t.employee).post('/api/employees', body).expect(403);
    await as(t.hr).post('/api/employees', body).expect(201);
    expect((await as(t.admin).get('/api/employees').expect(200)).body.total).toBe(1);
    await as(t.employee).get('/api/employees').expect(403);
  });

  it('validates input, department and designation, and duplicates', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const other = await createOrg(t.admin, { department: 'Sales', designation: 'Rep' });
    const base = { name: 'Z Z', email: 'zz@acme.test', departmentId: org.departmentId, joinDate: '2026-01-01', basicSalary: 1000 };

    await as(t.hr).post('/api/employees', { ...base, basicSalary: 0 }).expect(400);
    await as(t.hr).post('/api/employees', { ...base, joinDate: '01-01-2026' }).expect(400);
    await as(t.hr).post('/api/employees', { ...base, email: 'nope' }).expect(400);
    const wrongDesignation = await as(t.hr).post('/api/employees', { ...base, designationId: other.designationId }).expect(422);
    expect(wrongDesignation.body.error.code).toBe('INVALID_DESIGNATION');

    await as(t.hr).post('/api/employees', { ...base, code: 'E-1' }).expect(201);
    await as(t.hr).post('/api/employees', { ...base, email: 'zz2@acme.test', code: 'e-1' }).expect(409);
    await as(t.hr).post('/api/employees', base).expect(409);
    // An email that already belongs to a non-HR login cannot be reused.
    await as(t.hr).post('/api/employees', { ...base, email: 'emp@acme.test' }).expect(409);
  });

  it('links an existing HR login when HR registers themselves', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const res = await as(t.hr)
      .post('/api/employees', { name: 'HR Person', email: 'hr@acme.test', departmentId: org.departmentId, joinDate: '2026-01-01', basicSalary: 90000 })
      .expect(201);
    expect(res.body.login).toMatchObject({ role: 'hr', linkedExisting: true, temporaryPassword: null });
    const hr = await User.findOne({ email: 'hr@acme.test' });
    expect(String(hr.employee)).toBe(res.body.employee.id);

    // HR cannot raise their own salary or edit their own job record.
    await as(t.hr).put(`/api/employees/${res.body.employee.id}/salary`, { basic: 999999 }).expect(403);
    await as(t.hr).patch(`/api/employees/${res.body.employee.id}`, { status: 'active', joinDate: '2020-01-01' }).expect(403);
  });
});

describe('directory and Employee 360', () => {
  it('searches, filters and pages on the server', async () => {
    const t = await setupWithRoles();
    const eng = await createOrg(t.admin);
    const sales = await createOrg(t.admin, { department: 'Sales', designation: null });
    const mk = (name, departmentId, extra = {}) =>
      as(t.hr).post('/api/employees', { name, email: `${name.toLowerCase().replace(/\s/g, '')}@acme.test`, departmentId, joinDate: '2026-01-01', basicSalary: 1000, ...extra }).expect(201);
    await mk('Ayesha Malik', eng.departmentId);
    await mk('Bilal Shah', eng.departmentId, { status: 'probation' });
    await mk('Hamza Ali', sales.departmentId);

    const all = (await as(t.hr).get('/api/employees?limit=2').expect(200)).body;
    expect(all).toMatchObject({ total: 3, pages: 2 });
    expect(all.items.map((e) => e.name)).toEqual(['Ayesha Malik', 'Bilal Shah']);

    expect((await as(t.hr).get('/api/employees?search=hamza').expect(200)).body.items.map((e) => e.name)).toEqual(['Hamza Ali']);
    expect((await as(t.hr).get(`/api/employees?departmentId=${sales.departmentId}`).expect(200)).body.total).toBe(1);
    expect((await as(t.hr).get('/api/employees?status=probation').expect(200)).body.items[0].name).toBe('Bilal Shah');
    expect((await as(t.hr).get('/api/employees?search=EMP-0003').expect(200)).body.total).toBe(1);
  });

  it('lets an employee see only their own record and edit only phone and address', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const a = await registerEmployee(t.hr, org, { name: 'Emp A' });
    const b = await registerEmployee(t.hr, org, { name: 'Emp B' });

    expect((await as(a.token).get('/api/employees/me').expect(200)).body.name).toBe('Emp A');
    await as(a.token).get(`/api/employees/${a.employee.id}`).expect(200);
    await as(a.token).get(`/api/employees/${b.employee.id}`).expect(403);

    const updated = (await as(a.token).patch('/api/employees/me', { phone: '0300-1234567', address: 'Karachi', name: 'Hacker' }).expect(200)).body;
    expect(updated).toMatchObject({ phone: '0300-1234567', address: 'Karachi', name: 'Emp A' });
    await as(a.token).patch(`/api/employees/${a.employee.id}`, { name: 'Hacker' }).expect(403);
    await as(a.token).put(`/api/employees/${a.employee.id}/salary`, { basic: 999999 }).expect(403);
  });

  it('updates salary and exits an employee, deactivating their login', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const a = await registerEmployee(t.hr, org);

    const salary = (await as(t.hr).put(`/api/employees/${a.employee.id}/salary`, { basic: 200000 }).expect(200)).body.salary;
    expect(salary).toMatchObject({ basic: 200000, gross: 300000 });

    await as(t.hr).post(`/api/employees/${a.employee.id}/exit`, { exitDate: '2025-12-01' }).expect(422);
    const exited = (await as(t.hr).post(`/api/employees/${a.employee.id}/exit`, { exitDate: '2026-06-30', reason: 'Resigned' }).expect(200)).body;
    expect(exited).toMatchObject({ status: 'exited', exitDate: '2026-06-30' });
    await as(a.token).get('/api/employees/me').expect(401);

    const back = (await as(t.hr).patch(`/api/employees/${a.employee.id}`, { status: 'active' }).expect(200)).body;
    expect(back).toMatchObject({ status: 'active', exitDate: null });
    await api().post('/api/auth/login').send({ email: a.login.email, password: 'Passw0rd!' }).expect(200);
  });
});

describe('CSV import and export', () => {
  const header = 'code,name,email,department,designation,joinDate,basicSalary,status';

  it('dry run reports row + field + reason and imports nothing', async () => {
    const t = await setupWithRoles();
    await createOrg(t.admin);
    const csv = [
      header,
      'E-10,Good Row,good@acme.test,Engineering,Developer,2026-01-10,50000,active',
      ',No Email,,Engineering,,2026-01-10,50000,',
      'E-11,Bad Dept,bad@acme.test,Marketing,,2026-01-10,50000,',
      'E-12,Bad Date,date@acme.test,engineering,,10/01/2026,50000,',
      'E-13,Zero Salary,zero@acme.test,Engineering,,2026-01-10,0,',
      'E-10,Dup Code,dup@acme.test,Engineering,,2026-01-10,1,',
      'E-14,Dup Email,GOOD@acme.test,Engineering,,2026-01-10,1,',
      'E-15,Taken,emp@acme.test,Engineering,,2026-01-10,1,',
    ].join('\n');

    const res = (await as(t.hr).post('/api/employees/import?dryRun=true', { csv }).expect(200)).body;
    expect(res).toMatchObject({ totalRows: 8, validRows: 1, imported: 0, dryRun: true });
    const has = (row, field) => res.errors.some((e) => e.row === row && e.field === field);
    expect(has(3, 'email')).toBe(true);
    expect(has(4, 'department')).toBe(true);
    expect(has(5, 'joinDate')).toBe(true);
    expect(has(6, 'basicSalary')).toBe(true);
    expect(has(7, 'code')).toBe(true);
    expect(has(8, 'email')).toBe(true);
    expect(has(9, 'email')).toBe(true);

    // With errors, a real import is refused as a whole.
    const real = (await as(t.hr).post('/api/employees/import?dryRun=false', { csv }).expect(200)).body;
    expect(real.imported).toBe(0);
    expect((await as(t.hr).get('/api/employees').expect(200)).body.total).toBe(0);
  });

  it('imports valid files and exports them back', async () => {
    const t = await setupWithRoles();
    await createOrg(t.admin);
    const csv = `${header}\nE-20,"Khan, Imran",imran@acme.test,Engineering,Developer,2026-03-01,75000,probation\n,Noor Fatima,noor@acme.test,ENGINEERING,,2026-03-02,82000,\n`;
    const res = (await as(t.hr).post('/api/employees/import?dryRun=false', { csv }).expect(200)).body;
    expect(res).toMatchObject({ imported: 2, errorCount: 0 });
    expect(res.credentials.map((c) => c.email)).toEqual(['imran@acme.test', 'noor@acme.test']);
    await loginAs('noor@acme.test', res.credentials[1].temporaryPassword);

    const exported = await as(t.hr).get('/api/employees/export').expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('"Khan, Imran"');
    expect(exported.text.split('\r\n')[0]).toContain('basicSalary');
    await as(t.admin).get('/api/employees/export').expect(403);
  });

  it('rejects files without required columns', async () => {
    const t = await setupWithRoles();
    const res = await as(t.hr).post('/api/employees/import', { csv: 'name,email\nA,a@acme.test' }).expect(422);
    expect(res.body.error.code).toBe('INVALID_CSV');
  });
});

describe('role change for employee-linked logins', () => {
  it('Admin can promote an employee login to HR', async () => {
    const t = await setupWithRoles();
    const org = await createOrg(t.admin);
    const a = await registerEmployee(t.hr, org);
    const res = await as(t.admin).patch(`/api/users/${a.employee.userId}/role`, { role: 'hr' }).expect(200);
    expect(res.body.role).toBe('hr');
    await as(a.token).get('/api/auth/me').expect(401); // re-login needed for new permissions
    const plain = await createUser({ role: 'hr', email: 'plainhr@acme.test' });
    await as(t.admin).patch(`/api/users/${plain.id}/role`, { role: 'employee' }).expect(422);
    await as(t.hr).patch(`/api/users/${a.employee.userId}/role`, { role: 'hr' }).expect(403);
  });
});
