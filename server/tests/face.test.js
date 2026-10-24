import { afterEach, describe, expect, it } from 'vitest';
import { api, as, createOrg, registerEmployee, setupCompany, createUser, loginAs } from './helpers.js';
import { setNow } from '../src/utils/clock.js';
import { setProviderOverride, ProviderError } from '../src/services/ai/providers.js';
import { FaceProfile } from '../src/models/FaceProfile.js';
import { Notification } from '../src/models/Comms.js';
import { AiLog } from '../src/models/AiLog.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { inList } from '../src/utils/query.js';

afterEach(() => setProviderOverride(null));

const pkt = (date, time) => `${date}T${time}:00+05:00`;

/** A fake JPEG: valid magic bytes, a marker byte to tell "people" apart, padded to 3 KB. */
const photo = (who) => {
  const buf = Buffer.alloc(3000, 7);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = who.charCodeAt(0);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
};
const personOf = (img) => String.fromCharCode(Buffer.from(img.base64, 'base64')[2]);

/** Fake vision model: same person when the marker bytes of the reference and the live photo agree. */
function fakeVision(calls = []) {
  return async ({ images }) => {
    calls.push(images.map((i) => i.label));
    const live = personOf(images[images.length - 1]);
    const same = personOf(images[0]) === live;
    return {
      provider: 'gemini',
      model: 'fake',
      text: JSON.stringify({ same_person: same, confidence: same ? 0.93 : 0.12, live_face_count: live === 'Z' ? 0 : 1, spoof_suspected: live === 'S', reason: 'test' }),
    };
  };
}

async function world() {
  const { token: admin } = await setupCompany({ faceId: true });
  await createUser({ role: 'hr', email: 'hr@acme.test' });
  const hr = await loginAs('hr@acme.test');
  const org = await createOrg(admin);
  const emp = await registerEmployee(hr, org, { name: 'Ali Raza' });
  const emp2 = await registerEmployee(hr, org, { name: 'Bina Shah' });
  return { admin, hr, org, emp, emp2 };
}

describe('Face ID check-in', () => {
  it('HR enrolls at registration; check-in and check-out need a matching live face', async () => {
    const calls = [];
    setProviderOverride({ vision: { gemini: fakeVision(calls) } });
    const { token: admin } = await setupCompany({ faceId: true });
    await createUser({ role: 'hr', email: 'hr@acme.test' });
    const hr = await loginAs('hr@acme.test');
    const org = await createOrg(admin);
    const emp = await registerEmployee(hr, org, { name: 'Ali Raza', photo: photo('A') });
    expect(emp.employee.faceEnrolledAt).toBeTruthy();
    expect(emp.face).toMatchObject({ enrolled: true, source: 'hr' });

    setNow(pkt('2026-03-02', '09:05'));
    const today = (await as(emp.token).get('/api/attendance/today').expect(200)).body;
    expect(today).toMatchObject({ faceRequired: true, faceEnrolled: true });

    // Without a photo, and with someone else's face.
    expect((await as(emp.token).post('/api/attendance/check-in', {}).expect(422)).body.error.code).toBe('FACE_REQUIRED');
    const wrong = await as(emp.token).post('/api/attendance/check-in', { photo: photo('B') }).expect(422);
    expect(wrong.body.error.code).toBe('FACE_MISMATCH');
    expect(await Notification.countDocuments({ type: 'face_mismatch' })).toBe(1);

    const ok = (await as(emp.token).post('/api/attendance/check-in', { photo: photo('A') }).expect(201)).body;
    expect(ok).toMatchObject({ source: 'camera', status: 'present' });

    setNow(pkt('2026-03-02', '18:00'));
    await as(emp.token).post('/api/attendance/check-out', {}).expect(422);
    expect((await as(emp.token).post('/api/attendance/check-out', { photo: photo('A') }).expect(200)).body.checkOutTime).toBe('18:00');

    // The verified photo became a recent reference and the attempts were logged.
    const profile = await FaceProfile.findOne({ employee: emp.employee.id });
    expect(profile.recent.length).toBe(2);
    expect(calls[calls.length - 1]).toEqual(['enrolled reference photo', 'reference: recent verified check-in', 'LIVE photo taken now']);
    expect(await AiLog.countDocuments({ kind: 'face_verify' })).toBe(3);
  });

  it('refuses spoofed photos and photos without exactly one face', async () => {
    setProviderOverride({ vision: { gemini: fakeVision() } });
    const w = await world();
    await as(w.hr).put(`/api/employees/${w.emp.employee.id}/face`, { photo: photo('S') }).expect(200);
    setNow(pkt('2026-03-02', '09:05'));
    // Reference is 'S'; a live 'S' matches but is flagged as a spoof.
    expect((await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('S') }).expect(422)).body.error.message).toContain('screen');
    expect((await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('Z') }).expect(422)).body.error.message).toContain('No face');
    await as(w.emp.token).post('/api/attendance/check-in', { photo: 'data:image/jpeg;base64,AAAA' }).expect(422);
  });

  it('employees enroll their own face once; only HR/Admin can replace or reset it', async () => {
    setProviderOverride({ vision: { gemini: fakeVision() } });
    const w = await world();
    setNow(pkt('2026-03-02', '09:05'));
    expect((await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('A') }).expect(422)).body.error.code).toBe('FACE_NOT_ENROLLED');

    expect((await as(w.emp.token).put('/api/employees/me/face', { photo: photo('A') }).expect(200)).body).toMatchObject({ enrolled: true, source: 'self' });
    expect((await as(w.emp.token).put('/api/employees/me/face', { photo: photo('B') }).expect(403)).body.error.code).toBe('FACE_ALREADY_ENROLLED');
    await as(w.emp.token).put(`/api/employees/${w.emp.employee.id}/face`, { photo: photo('B') }).expect(403);
    await as(w.emp.token).put(`/api/employees/${w.emp2.employee.id}/face`, { photo: photo('A') }).expect(403);

    // Own photo is readable; a colleague's is not.
    const own = await as(w.emp.token).get(`/api/employees/${w.emp.employee.id}/face/photo`).expect(200);
    expect(own.headers['content-type']).toBe('image/jpeg');
    await as(w.emp.token).get(`/api/employees/${w.emp2.employee.id}/face/photo`).expect(403);

    await as(w.admin).put(`/api/employees/${w.emp.employee.id}/face`, { photo: photo('C') }).expect(200);
    await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('A') }).expect(422);
    await as(w.hr).delete(`/api/employees/${w.emp.employee.id}/face`).expect(200);
    expect((await as(w.hr).get(`/api/employees/${w.emp.employee.id}/face`).expect(200)).body).toEqual({ enrolled: false });
    expect(await AuditLog.countDocuments({ action: inList(['employee.face_enroll', 'employee.face_reenroll', 'employee.face_reset']) })).toBe(3);
  });

  it('falls back to Groq and fails gracefully when no AI is available', async () => {
    const w = await world();
    await as(w.hr).put(`/api/employees/${w.emp.employee.id}/face`, { photo: photo('A') }).expect(200);
    setNow(pkt('2026-03-02', '09:05'));

    setProviderOverride({
      vision: {
        gemini: async () => {
          throw new ProviderError('quota', { code: 'RATE_LIMITED' });
        },
        groq: async () => {
          throw new ProviderError('down', { code: 'OVERLOADED' });
        },
      },
    });
    expect((await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('A') }).expect(503)).body.error.code).toBe('FACE_CHECK_UNAVAILABLE');

    const groq = fakeVision();
    setProviderOverride({
      vision: {
        gemini: async () => {
          throw new ProviderError('quota', { code: 'RATE_LIMITED' });
        },
        groq: async (args) => ({ ...(await groq(args)), provider: 'groq' }),
      },
    });
    await as(w.emp.token).post('/api/attendance/check-in', { photo: photo('A') }).expect(201);
  });

  it('Admin can switch Face ID off; then plain web check-in works', async () => {
    const w = await world();
    expect((await as(w.admin).put('/api/settings', { faceCheckInRequired: false }).expect(200)).body.faceCheckInRequired).toBe(false);
    await as(w.hr).put('/api/settings', { faceCheckInRequired: true }).expect(403);
    setNow(pkt('2026-03-02', '09:05'));
    expect((await as(w.emp.token).post('/api/attendance/check-in').expect(201)).body.source).toBe('web');
    await api().get('/api/health').expect(200);
  });
});
