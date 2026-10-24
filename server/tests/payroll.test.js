import { describe, expect, it } from 'vitest';
import { as, createOrg, registerEmployee, setupWithRoles } from './helpers.js';
import { setNow } from '../src/utils/clock.js';
import { yearlyTax } from '../src/services/payroll.calc.js';
import { Attendance } from '../src/models/Attendance.js';
import { LeaveRequest } from '../src/models/LeaveRequest.js';
import { LeaveType } from '../src/models/LeaveType.js';
import { User } from '../src/models/User.js';
import { workingDaysBetween } from '../src/utils/time.js';
import { inList } from '../src/utils/query.js';

describe('tax slabs (brief, Section 3, M6)', () => {
  it('matches every slab boundary', () => {
    expect(yearlyTax(600000)).toBe(0);
    expect(yearlyTax(1200000)).toBe(30000);
    expect(yearlyTax(2400000)).toBe(210000);
    expect(yearlyTax(3600000)).toBe(510000);
    expect(yearlyTax(4600000)).toBe(860000);
    expect(yearlyTax(1800000)).toBe(120000);
  });
});

const MARCH_WORKING_DAYS = workingDaysBetween('2026-03-01', '2026-03-31', { weekendDays: [6, 0], holidays: new Set() });

async function addRecords(employeeId, dates, { halfDay = [] } = {}) {
  await Attendance.insertMany(
    dates.map((date) => ({
      employee: employeeId,
      date,
      checkIn: new Date(`${date}T04:00:00Z`),
      checkOut: new Date(`${date}T${halfDay.includes(date) ? '07' : '13'}:00:00Z`),
      status: halfDay.includes(date) ? 'half_day' : 'present',
      workedMinutes: halfDay.includes(date) ? 180 : 540,
    })),
  );
}

async function marchWorld() {
  const t = await setupWithRoles();
  const org = await createOrg(t.admin);
  setNow('2026-03-01T06:00:00Z');
  const a = await registerEmployee(t.hr, org, { name: 'Amna Full', joinDate: '2026-01-01', basicSalary: 100000 });
  const b = await registerEmployee(t.hr, org, { name: 'Babar Joiner', joinDate: '2026-03-16', basicSalary: 60000 });

  // Amna: 2 absent (Mar 2, 3), 2 unpaid leave (Mar 4, 5), 1 half day (Mar 6), present otherwise.
  const unpaid = await LeaveType.findOne({ code: 'unpaid' });
  const hrUser = await User.findOne({ email: 'hr@acme.test' });
  await LeaveRequest.create({ employee: a.employee.id, leaveType: unpaid._id, startDate: '2026-03-04', endDate: '2026-03-05', days: 2, status: 'approved', requestedBy: hrUser._id });
  await addRecords(a.employee.id, MARCH_WORKING_DAYS.filter((d) => !['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].includes(d)), { halfDay: ['2026-03-06'] });
  // Babar: present every working day from 16 March.
  await addRecords(b.employee.id, MARCH_WORKING_DAYS.filter((d) => d >= '2026-03-16'));

  setNow('2026-04-02T06:00:00Z');
  return { ...t, a, b };
}

describe('payroll runs', () => {
  it('calculates deductions, proration and tax exactly as the brief says', async () => {
    const w = await marchWorld();
    expect(MARCH_WORKING_DAYS).toHaveLength(22);
    const run = (await as(w.hr).post('/api/payroll/runs', { month: '2026-03' }).expect(201)).body;
    expect(run).toMatchObject({ month: '2026-03', status: 'draft', workingDays: 22 });

    const amna = run.payslips.find((p) => p.employeeName === 'Amna Full');
    expect(amna).toMatchObject({
      basic: 100000, hra: 40000, medical: 10000, gross: 150000,
      absentDays: 2, unpaidLeaveDays: 2, halfDays: 1, deductionDays: 4.5,
      perDay: 6818.18, earned: 150000, deductions: 30681.82, tax: 10000, net: 109318.18, prorated: false,
    });

    const babar = run.payslips.find((p) => p.employeeName === 'Babar Joiner');
    expect(babar).toMatchObject({ gross: 90000, employedDays: 12, earned: 49090.91, deductions: 0, tax: 1090.91, net: 48000, prorated: true });

    expect(run.totals).toMatchObject({ employees: 2, net: 157318.18 });
  });

  it('HR drafts, only Admin finalizes, and finalized runs are locked', async () => {
    const w = await marchWorld();
    const run = (await as(w.hr).post('/api/payroll/runs', { month: '2026-03' }).expect(201)).body;
    await as(w.admin).post('/api/payroll/runs', { month: '2026-02' }).expect(403);
    await as(w.employee).get('/api/payroll/runs').expect(403);
    await as(w.hr).post('/api/payroll/runs', { month: '2026-05' }).expect(422); // future month

    // Employees see nothing until it is finalized.
    expect((await as(w.a.token).get('/api/payslips').expect(200)).body).toEqual([]);

    await as(w.hr).post(`/api/payroll/runs/${run.id}/finalize`).expect(403);
    const fin = (await as(w.admin).post(`/api/payroll/runs/${run.id}/finalize`).expect(200)).body;
    expect(fin.status).toBe('finalized');

    const lockedRecalc = await as(w.hr).post(`/api/payroll/runs/${run.id}/recalculate`).expect(423);
    expect(lockedRecalc.body.error.code).toBe('PAYROLL_LOCKED');
    await as(w.hr).post('/api/payroll/runs', { month: '2026-03' }).expect(423);
    await as(w.admin).post(`/api/payroll/runs/${run.id}/finalize`).expect(423);
  });

  it('lets an employee download only their own finalized payslip as a PDF', async () => {
    const w = await marchWorld();
    const run = (await as(w.hr).post('/api/payroll/runs', { month: '2026-03' }).expect(201)).body;
    await as(w.admin).post(`/api/payroll/runs/${run.id}/finalize`).expect(200);

    const mine = (await as(w.a.token).get('/api/payslips').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ employeeName: 'Amna Full', net: 109318.18 });

    const pdf = await as(w.a.token).get(`/api/payslips/${mine[0].id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    const babarSlip = run.payslips.find((p) => p.employeeName === 'Babar Joiner');
    await as(w.a.token).get(`/api/payslips/${babarSlip.id}/pdf`).expect(404);
    await as(w.hr).get(`/api/payslips/${babarSlip.id}/pdf`).expect(200);
  });

  it('applies the optional late penalty (3 lates = 0.5 day) when Admin enables it', async () => {
    const w = await marchWorld();
    // Make three of Babar's days late.
    await Attendance.updateMany({ employee: w.b.employee.id, date: inList(['2026-03-16', '2026-03-17', '2026-03-18']) }, { status: 'late', lateMinutes: 20 });
    let run = (await as(w.hr).post('/api/payroll/runs', { month: '2026-03' }).expect(201)).body;
    expect(run.payslips.find((p) => p.employeeName === 'Babar Joiner')).toMatchObject({ lateDays: 3, latePenaltyDays: 0 });

    await as(w.admin).put('/api/settings', { latePenaltyEnabled: true }).expect(200);
    run = (await as(w.hr).post(`/api/payroll/runs/${run.id}/recalculate`).expect(200)).body;
    expect(run.payslips.find((p) => p.employeeName === 'Babar Joiner')).toMatchObject({ lateDays: 3, latePenaltyDays: 0.5, deductions: 2045.45 });
  });
});
