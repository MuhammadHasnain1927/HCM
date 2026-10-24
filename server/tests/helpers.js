import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Settings } from '../src/models/Settings.js';
import { hashPassword } from '../src/utils/password.js';

export const app = createApp();
export const api = () => request(app);

export const ADMIN = {
  companyName: 'Acme Pvt Ltd',
  adminName: 'Sara Admin',
  adminEmail: 'admin@acme.test',
  adminPassword: 'Admin12345',
};

/**
 * Runs first-run setup and returns the Admin session. Face ID is switched off
 * so attendance tests can check in without a camera; tests/face.test.js turns it on.
 */
export async function setupCompany({ faceId = false } = {}) {
  const res = await api().post('/api/setup').send(ADMIN).expect(201);
  if (!faceId) await Settings.updateOne({ key: 'company' }, { faceCheckInRequired: false });
  return res.body;
}

/** Creates a user directly in the database (other modules will create them through the API). */
export async function createUser({ role, email, password = 'Passw0rd!', mustChangePassword = false, ...rest }) {
  return User.create({
    name: rest.name || `${role} user`,
    email,
    passwordHash: await hashPassword(password),
    role,
    mustChangePassword,
    ...rest,
  });
}

export async function loginAs(email, password = 'Passw0rd!') {
  const res = await api().post('/api/auth/login').send({ email, password });
  return res.body.token;
}

/** Sets up the company and returns tokens for an Admin, an HR user and an Employee. */
export async function setupWithRoles() {
  const { token: admin } = await setupCompany();
  await createUser({ role: 'hr', email: 'hr@acme.test' });
  await createUser({ role: 'employee', email: 'emp@acme.test', employee: new mongoose.Types.ObjectId() });
  return { admin, hr: await loginAs('hr@acme.test'), employee: await loginAs('emp@acme.test') };
}

/** Creates a department (+ optional designation) through the API as Admin. */
export async function createOrg(adminToken, { department = 'Engineering', designation = 'Developer' } = {}) {
  const dept = (await as(adminToken).post('/api/org/departments', { name: department }).expect(201)).body;
  const des = designation
    ? (await as(adminToken).post('/api/org/designations', { title: designation, departmentId: dept.id }).expect(201)).body
    : null;
  return { departmentId: dept.id, designationId: des?.id ?? null };
}

/** HR registers an employee; returns { employee, login, token } with the password already changed. */
export async function registerEmployee(hrToken, org, overrides = {}) {
  const body = {
    name: 'Ali Khan',
    email: `ali${Math.random().toString(36).slice(2, 8)}@acme.test`,
    departmentId: org.departmentId,
    designationId: org.designationId,
    joinDate: '2026-01-01',
    basicSalary: 100000,
    ...overrides,
  };
  const res = await as(hrToken).post('/api/employees', body).expect(201);
  const login = await api().post('/api/auth/login').send({ email: res.body.login.email, password: res.body.login.temporaryPassword }).expect(200);
  const changed = await as(login.body.token)
    .post('/api/auth/change-password', { currentPassword: res.body.login.temporaryPassword, newPassword: 'Passw0rd!' })
    .expect(200);
  return { ...res.body, token: changed.body.token };
}

/** Authenticated request helpers: as(token).get('/api/...') */
export const as = (token) => ({
  get: (url) => api().get(url).set('Authorization', `Bearer ${token}`),
  post: (url, body) => api().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  put: (url, body) => api().put(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  patch: (url, body) => api().patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  delete: (url) => api().delete(url).set('Authorization', `Bearer ${token}`),
});
