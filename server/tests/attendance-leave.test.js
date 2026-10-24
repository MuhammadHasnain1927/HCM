import { describe, expect, it } from 'vitest';
import { as, createOrg, registerEmployee, setupWithRoles } from './helpers.js';
import { setNow } from '../src/utils/clock.js';
import { Notification } from '../src/models/Comms.js';

// Asia/Karachi is UTC+5, so 09:10 local = 04:10Z. 2 March 2026 is a Monday.
const pkt = (date, time) => `${date}T${time}:00+05:00`;

async function world() {
  const t = await setupWithRoles();
  const org = await createOrg(t.admin);
  const emp = await registerEmployee(t.hr, org, { name: 'Ali Raza', joinDate: '2026-01-01' });
  const emp2 = await registerEmployee(t.hr, org, { name: 'Bina Shah', joinDate: '2026-01-01' });
  return { ...t, org, emp, emp2 };
}

describe('check-in and check-out', () => {
  it('stamps present before 09:15, late after, half day under 5 hours, one record per day', async () => {
    const w = await world();

    setNow(pkt('2026-03-02', '09:10'));
    const inRes = (await as(w.emp.token).post('/api/attendance/check-in').expect(201)).body;
    expect(inRes).toMatchObject({ date: '2026-03-02', status: 'present', checkInTime: '09:10', source: 'web' });
    const again = await as(w.emp.token).post('/api/attendance/check-in').expect(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');

    setNow(pkt('2026-03-02', '18:05'));
    const out = (await as(w.emp.token).post('/api/attendance/check-out').expect(200)).body;
    expect(out).toMatchObject({ status: 'present', checkOutTime: '18:05', workedMinutes: 535 });
    await as(w.emp.token).post('/api/attendance/check-out').expect(409);

    setNow(pkt('2026-03-03', '09:20'));
    expect((await as(w.emp.token).post('/api/attendance/check-in').expect(201)).body).toMatchObject({ status: 'late', lateMinutes: 20 });
    setNow(pkt('2026-03-03', '13:00'));
    expect((await as(w.emp.token).post('/api/attendance/check-out').expect(200)).body.status).toBe('half_day');
  });

  it('refuses Admin, check-out without check-in, and days before joining', async () => {
    const w = await world();
    setNow(pkt('2026-03-02', '09:00'));
    await as(w.admin).post('/api/attendance/check-in').expect(403);
    const noIn = await as(w.emp.token).post('/api/attendance/check-out').expect(422);
    expect(noIn.body.error.code).toBe('NOT_CHECKED_IN');

    setNow(pkt('2025-12-15', '09:00'));
    expect((await as(w.emp.token).post('/api/attendance/check-in').expect(422)).body.error.code).toBe('NOT_STARTED');
  });

  it('derives missing_checkout, absent and today states in the month calendar', async () => {
    const w = await world();
    setNow(pkt('2026-03-02', '09:00'));
    await as(w.emp.token).post('/api/attendance/check-in').expect(201); // never checks out

    setNow(pkt('2026-03-04', '10:00'));
    const cal = (await as(w.emp.token).get('/api/attendance/calendar?month=2026-03').expect(200)).body;
    const byDate = Object.fromEntries(cal.days.map((d) => [d.date, d.status]));
    expect(byDate['2026-03-01']).toBe('weekend');
    expect(byDate['2026-03-02']).toBe('missing_checkout');
    expect(byDate['2026-03-03']).toBe('absent');
    expect(byDate['2026-03-04']).toBe('not_checked_in');
    expect(byDate['2026-03-05']).toBe('upcoming');
    expect(cal.counts).toMatchObject({ missing_checkout: 1, absent: 1, expected: 2 });

    // An employee cannot read someone else's calendar; HR can.
    await as(w.emp.token).get(`/api/attendance/calendar?month=2026-03&employeeId=${w.emp2.employee.id}`).expect(403);
    await as(w.hr).get(`/api/attendance/calendar?month=2026-03&employeeId=${w.emp2.employee.id}`).expect(200);
  });

  it('shows the daily board to Admin and HR only', async () => {
    const w = await world();
    setNow(pkt('2026-03-02', '09:30'));
    await as(w.emp.token).post('/api/attendance/check-in').expect(201);
    const board = (await as(w.admin).get('/api/attendance/board').expect(200)).body;
    expect(board.date).toBe('2026-03-02');
    expect(board.summary).toMatchObject({ late: 1, not_checked_in: 1 });
    expect(board.rows.find((r) => r.name === 'Ali Raza').record.checkInTime).toBe('09:30');
    await as(w.emp.token).get('/api/attendance/board').expect(403);
  });
});

describe('camera check-in (bonus)', () => {
  it('accepts exactly one face inside the office radius with good GPS', async () => {
    const w = await world();
    await as(w.admin).put('/api/settings', { office: { lat: 24.8607, lng: 67.0011, radiusMeters: 150 } }).expect(200);
    setNow(pkt('2026-03-02', '09:05'));
    const near = { source: 'camera', lat: 24.8608, lng: 67.0012, accuracy: 20, faceCount: 1 };

    expect((await as(w.emp.token).post('/api/attendance/check-in', { ...near, faceCount: 0 }).expect(422)).body.error.code).toBe('FACE_CHECK_FAILED');
    expect((await as(w.emp.token).post('/api/attendance/check-in', { ...near, faceCount: 2 }).expect(422)).body.error.code).toBe('FACE_CHECK_FAILED');
    expect((await as(w.emp.token).post('/api/attendance/check-in', { ...near, accuracy: 250 }).expect(422)).body.error.code).toBe('GPS_INACCURATE');
    const far = await as(w.emp.token).post('/api/attendance/check-in', { ...near, lat: 24.87, lng: 67.02 }).expect(422);
    expect(far.body.error.code).toBe('OUTSIDE_OFFICE');
    expect(far.body.error.details.distanceMeters).toBeGreaterThan(150);

    const ok = (await as(w.emp.token).post('/api/attendance/check-in', near).expect(201)).body;
    expect(ok).toMatchObject({ source: 'camera', status: 'present' });
    expect(ok.distanceMeters).toBeLessThanOrEqual(150);
  });
});

describe('attendance corrections', () => {
  it('employee requests, HR approves and the record is rebuilt with the rules', async () => {
    const w = await world();
    setNow(pkt('2026-03-04', '10:00'));
    const c = (await as(w.emp.token).post('/api/attendance/corrections', { date: '2026-03-03', checkIn: '09:20', checkOut: '18:00', reason: 'Forgot to check in' }).expect(201)).body;
    await as(w.emp.token).post('/api/attendance/corrections', { date: '2026-03-03', checkIn: '09:00', reason: 'Again' }).expect(409);
    await as(w.emp.token).post('/api/attendance/corrections', { date: '2026-03-09', checkIn: '09:00', reason: 'Future' }).expect(422);
    expect(await Notification.countDocuments({ type: 'correction.requested' })).toBe(1);

    await as(w.emp.token).patch(`/api/attendance/corrections/${c.id}`, { decision: 'approved' }).expect(403);
    await as(w.hr).patch(`/api/attendance/corrections/${c.id}`, { decision: 'rejected' }).expect(422); // comment required
    await as(w.hr).patch(`/api/attendance/corrections/${c.id}`, { decision: 'approved', comment: 'OK' }).expect(200);

    const cal = (await as(w.emp.token).get('/api/attendance/calendar?month=2026-03').expect(200)).body;
    const day = cal.days.find((d) => d.date === '2026-03-03');
    expect(day).toMatchObject({ status: 'late' });
    expect(day.record).toMatchObject({ checkInTime: '09:20', checkOutTime: '18:00', source: 'correction', lateMinutes: 20 });
    expect(await Notification.countDocuments({ type: 'correction.decided' })).toBe(1);
  });
});

describe('leave', () => {
  async function types(token) {
    const list = (await as(token).get('/api/leaves/types').expect(200)).body;
    return Object.fromEntries(list.map((x) => [x.code, x.id]));
  }

  it('counts working days only and enforces overlap and balance with 422', async () => {
    const w = await world();
    await as(w.admin).post('/api/org/holidays', { date: '2026-03-11', name: 'Test Holiday' }).expect(201);
    setNow(pkt('2026-03-02', '10:00'));
    const lt = await types(w.emp.token);

    // Mon 9 - Sun 15 March = 5 weekdays - 1 holiday = 4 days.
    const leave = (await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.casual, startDate: '2026-03-09', endDate: '2026-03-15', reason: 'Family' }).expect(201)).body;
    expect(leave).toMatchObject({ days: 4, status: 'pending', leaveTypeCode: 'casual' });
    expect((await as(w.emp.token).get('/api/leaves/preview?startDate=2026-03-09&endDate=2026-03-15').expect(200)).body.days).toBe(4);

    const overlap = await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.sick, startDate: '2026-03-13', endDate: '2026-03-13' }).expect(422);
    expect(overlap.body.error.code).toBe('LEAVE_OVERLAP');

    // Casual quota 10, 4 pending -> 6 available; 7 working days requested.
    const over = await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.casual, startDate: '2026-04-01', endDate: '2026-04-09' }).expect(422);
    expect(over.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const weekend = await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.sick, startDate: '2026-03-07', endDate: '2026-03-08' }).expect(422);
    expect(weekend.body.error.code).toBe('NO_WORKING_DAYS');

    // Unpaid leave is unlimited.
    await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.unpaid, startDate: '2026-05-04', endDate: '2026-05-29' }).expect(201);

    const balance = (await as(w.emp.token).get('/api/leaves/balance?year=2026').expect(200)).body.balances;
    expect(balance.find((b) => b.code === 'casual')).toMatchObject({ quota: 10, used: 0, pending: 4, remaining: 10, available: 6 });
    expect(balance.find((b) => b.code === 'unpaid')).toMatchObject({ quota: null, remaining: null });
  });

  it('HR approves with a comment; the employee sees the balance and gets notified', async () => {
    const w = await world();
    setNow(pkt('2026-03-02', '10:00'));
    const lt = await types(w.emp.token);
    const leave = (await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.sick, startDate: '2026-03-05', endDate: '2026-03-06' }).expect(201)).body;
    expect(await Notification.countDocuments({ type: 'leave.requested' })).toBe(1);

    await as(w.emp2.token).patch(`/api/leaves/${leave.id}/decision`, { decision: 'approved' }).expect(403);
    await as(w.admin).patch(`/api/leaves/${leave.id}/decision`, { decision: 'approved' }).expect(403);
    await as(w.hr).patch(`/api/leaves/${leave.id}/decision`, { decision: 'approved', comment: 'Get well soon' }).expect(200);
    await as(w.hr).patch(`/api/leaves/${leave.id}/decision`, { decision: 'rejected', comment: 'x' }).expect(422);

    const sick = (await as(w.emp.token).get('/api/leaves/balance').expect(200)).body.balances.find((b) => b.code === 'sick');
    expect(sick).toMatchObject({ quota: 8, used: 2, remaining: 6 });
    expect(await Notification.countDocuments({ type: 'leave.decided' })).toBe(1);

    // On approved leave: no check-in; the calendar shows on_leave.
    setNow(pkt('2026-03-05', '09:00'));
    expect((await as(w.emp.token).post('/api/attendance/check-in').expect(422)).body.error.code).toBe('ON_LEAVE');
    setNow(pkt('2026-03-09', '09:00'));
    const cal = (await as(w.emp.token).get('/api/attendance/calendar?month=2026-03').expect(200)).body;
    expect(cal.days.find((d) => d.date === '2026-03-05')).toMatchObject({ status: 'on_leave', leaveType: 'Sick leave' });

    const onLeave = (await as(w.hr).get('/api/leaves/on-leave?date=2026-03-06').expect(200)).body;
    expect(onLeave.map((x) => x.employeeName)).toEqual(['Ali Raza']);
  });

  it('lets employees cancel pending or future leave and see only their own requests', async () => {
    const w = await world();
    setNow(pkt('2026-03-02', '10:00'));
    const lt = await types(w.emp.token);
    const a = (await as(w.emp.token).post('/api/leaves', { leaveTypeId: lt.annual, startDate: '2026-03-16', endDate: '2026-03-17' }).expect(201)).body;
    await as(w.emp2.token).post('/api/leaves', { leaveTypeId: lt.annual, startDate: '2026-03-16', endDate: '2026-03-16' }).expect(201);

    expect((await as(w.emp.token).get('/api/leaves').expect(200)).body.total).toBe(1);
    expect((await as(w.hr).get('/api/leaves?status=pending').expect(200)).body.total).toBe(2);
    await as(w.emp2.token).patch(`/api/leaves/${a.id}/cancel`).expect(403);
    expect((await as(w.emp.token).patch(`/api/leaves/${a.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    await as(w.emp.token).patch(`/api/leaves/${a.id}/cancel`).expect(422);
  });
});
