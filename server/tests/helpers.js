import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

export const app = createApp();
export const api = () => request(app);

export const ADMIN = {
  companyName: 'Acme Pvt Ltd',
  adminName: 'Sara Admin',
  adminEmail: 'admin@acme.test',
  adminPassword: 'Admin12345',
};

/** Runs first-run setup and returns the Admin session. */
export async function setupCompany() {
  const res = await api().post('/api/setup').send(ADMIN).expect(201);
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

/** Authenticated request helpers: as(token).get('/api/...') */
export const as = (token) => ({
  get: (url) => api().get(url).set('Authorization', `Bearer ${token}`),
  post: (url, body) => api().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  put: (url, body) => api().put(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  patch: (url, body) => api().patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  delete: (url) => api().delete(url).set('Authorization', `Bearer ${token}`),
});
