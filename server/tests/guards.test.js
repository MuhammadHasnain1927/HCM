import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { requireAuth, requireRole, employeeScope, assertEmployeeAccess } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { ROLES } from '../src/models/User.js';
import { createUser, loginAs, setupCompany } from './helpers.js';

// A small app with routes guarded the same way the real modules will be.
const guarded = express();
guarded.get('/admin-only', requireAuth, requireRole(ROLES.ADMIN), (_req, res) => res.json({ ok: true }));
guarded.get('/managers', requireAuth, requireRole(ROLES.ADMIN, ROLES.HR), (_req, res) => res.json({ ok: true }));
guarded.get('/scope', requireAuth, (req, res) => res.json(employeeScope(req.user)));
guarded.use(errorHandler);

async function tokens() {
  const { token: admin } = await setupCompany();
  await createUser({ role: ROLES.HR, email: 'hr@acme.test' });
  const employeeId = new mongoose.Types.ObjectId();
  await createUser({ role: ROLES.EMPLOYEE, email: 'emp@acme.test', employee: employeeId });
  await createUser({ role: ROLES.EMPLOYEE, email: 'temp@acme.test', mustChangePassword: true, employee: new mongoose.Types.ObjectId() });
  return {
    admin,
    hr: await loginAs('hr@acme.test'),
    employee: await loginAs('emp@acme.test'),
    temp: await loginAs('temp@acme.test'),
    employeeId: employeeId.toString(),
  };
}

const get = (path, token) => request(guarded).get(path).set('Authorization', `Bearer ${token}`);

describe('role guards', () => {
  it('lets each role reach only its own routes', async () => {
    const t = await tokens();
    await get('/admin-only', t.admin).expect(200);
    await get('/admin-only', t.hr).expect(403);
    await get('/admin-only', t.employee).expect(403);

    await get('/managers', t.admin).expect(200);
    await get('/managers', t.hr).expect(200);
    await get('/managers', t.employee).expect(403);
  });

  it('blocks protected routes until a temporary password is changed', async () => {
    const t = await tokens();
    const res = await get('/scope', t.temp).expect(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('data scope', () => {
  it('limits an Employee to their own rows and leaves Admin/HR unrestricted', async () => {
    const t = await tokens();
    expect((await get('/scope', t.admin).expect(200)).body).toEqual({});
    expect((await get('/scope', t.hr).expect(200)).body).toEqual({});
    expect((await get('/scope', t.employee).expect(200)).body).toEqual({ employee: t.employeeId });
  });

  it('assertEmployeeAccess refuses another employee\'s record', () => {
    const me = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const employee = { role: ROLES.EMPLOYEE, employee: me };
    expect(() => assertEmployeeAccess(employee, me)).not.toThrow();
    expect(() => assertEmployeeAccess(employee, other)).toThrow();
    expect(() => assertEmployeeAccess({ role: ROLES.HR }, other)).not.toThrow();
  });
});
