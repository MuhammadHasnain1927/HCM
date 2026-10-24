import { afterEach, describe, expect, it } from 'vitest';
import { as, createOrg, registerEmployee, setupWithRoles } from './helpers.js';
import { setNow } from '../src/utils/clock.js';
import { setProviderOverride, ProviderError } from '../src/services/ai/providers.js';
import { AiLog } from '../src/models/AiLog.js';
import { Announcement, Notification } from '../src/models/Comms.js';

const pkt = (date, time) => `${date}T${time}:00+05:00`;

afterEach(() => setProviderOverride(null));

async function world() {
  const t = await setupWithRoles();
  const eng = await createOrg(t.admin);
  const sales = await createOrg(t.admin, { department: 'Sales', designation: null });
  setNow(pkt('2026-03-02', '08:00'));
  const a = await registerEmployee(t.hr, eng, { name: 'Ali Raza', joinDate: '2026-01-01', gender: 'male', basicSalary: 100000 });
  const b = await registerEmployee(t.hr, eng, { name: 'Bina Shah', joinDate: '2026-01-01', gender: 'female', basicSalary: 80000 });
  const c = await registerEmployee(t.hr, sales, { name: 'Chand Bibi', joinDate: '2026-02-01', gender: 'female', basicSalary: 60000 });
  // Monday: Ali on time, Bina late, Chand absent.
  setNow(pkt('2026-03-02', '09:05'));
  await as(a.token).post('/api/attendance/check-in').expect(201);
  setNow(pkt('2026-03-02', '09:40'));
  await as(b.token).post('/api/attendance/check-in').expect(201);
  setNow(pkt('2026-03-02', '18:00'));
  await as(a.token).post('/api/attendance/check-out').expect(200);
  await as(b.token).post('/api/attendance/check-out').expect(200);
  // Tuesday 10:00: Ali in, Bina on approved sick leave today.
  setNow(pkt('2026-03-03', '08:30'));
  const types = Object.fromEntries((await as(b.token).get('/api/leaves/types').expect(200)).body.map((x) => [x.code, x.id]));
  const leave = (await as(b.token).post('/api/leaves', { leaveTypeId: types.sick, startDate: '2026-03-03', endDate: '2026-03-03' }).expect(201)).body;
  await as(t.hr).patch(`/api/leaves/${leave.id}/decision`, { decision: 'approved' }).expect(200);
  setNow(pkt('2026-03-03', '09:00'));
  await as(a.token).post('/api/attendance/check-in').expect(201);
  setNow(pkt('2026-03-03', '10:00'));
  return { ...t, eng, sales, a, b, c, types };
}

describe('dashboards', () => {
  it('HR dashboard numbers match the records', async () => {
    const w = await world();
    const d = (await as(w.hr).get('/api/analytics/hr?from=2026-03-02&to=2026-03-03').expect(200)).body;
    expect(d.kpis).toMatchObject({ headcount: 3, presentToday: 1, onLeaveToday: 1, lateToday: 0, notCheckedInToday: 1, pendingApprovals: 0 });
    // Expected days: Mon 3 (Ali present, Bina late, Chand absent); Tue only Bina on leave counts (others not yet decided / in progress).
    // Tue: Ali checked in (present, in progress) counts; Chand not checked in yet (not counted).
    // present 2 (Ali x2) + late 1 = 3 attended; denominator = expected 5 - on_leave 1 = 4 -> 75%.
    expect(d.kpis.attendanceRate).toBe(75);
    expect(d.kpis.latePercent).toBe(33.3);
    expect(d.topLateComers).toEqual([{ name: 'Bina Shah', department: 'Engineering', lateDays: 1 }]);
    expect(d.leaveByType).toEqual([{ leaveType: 'Sick leave', days: 1 }]);
    expect(d.today.onLeaveList.map((x) => x.name)).toEqual(['Bina Shah']);

    const salesOnly = (await as(w.hr).get(`/api/analytics/hr?from=2026-03-02&to=2026-03-03&departmentId=${w.sales.departmentId}`).expect(200)).body;
    expect(salesOnly.kpis).toMatchObject({ headcount: 1, absenteeism: 100 });
    await as(w.a.token).get('/api/analytics/hr').expect(403);
  });

  it('Admin dashboard shows headcount, attrition, salaries and the audit feed', async () => {
    const w = await world();
    await as(w.hr).post(`/api/employees/${w.c.employee.id}/exit`, { exitDate: '2026-03-03', reason: 'Moved' }).expect(200);
    const d = (await as(w.admin).get('/api/analytics/admin').expect(200)).body;
    expect(d.kpis.headcount).toBe(2);
    expect(d.kpis.exitsYtd).toBe(1);
    // avg headcount = (start of year 2 + now 2) / 2 = 2 -> 1 / 2 = 50%.
    expect(d.kpis.attritionYtd).toBe(50);
    expect(d.kpis.averageSalary).toBe(135000); // (150000 + 120000) / 2
    expect(d.headcountByDepartment).toEqual([{ department: 'Engineering', count: 2 }]);
    expect(d.auditFeed.length).toBeGreaterThan(0);
    await as(w.hr).get('/api/analytics/admin').expect(403);
  });

  it('Employee dashboard shows own hours, late count and balances', async () => {
    const w = await world();
    const d = (await as(w.b.token).get('/api/analytics/me').expect(200)).body;
    expect(d).toMatchObject({ hasEmployeeRecord: true, todayStatus: 'on_leave', lateThisMonth: 1 });
    expect(d.hoursThisWeek).toBeGreaterThan(8);
    expect(d.leaveBalances.find((x) => x.code === 'sick')).toMatchObject({ used: 1, remaining: 7 });
  });
});

describe('AI assistant (with a fake model)', () => {
  /** A fake model that calls one tool, then answers with what the tool returned. */
  const toolThenAnswer = (toolName, args, answerFrom) => {
    const calls = [];
    const fn = async ({ messages, tools }) => {
      calls.push({ tools: tools.map((t) => t.name) });
      const toolMsg = messages.find((m) => m.role === 'tool');
      if (!toolMsg) return { provider: 'fake', model: 'fake-1', text: '', toolCalls: [{ id: 't1', name: toolName, args }], raw: {} };
      return { provider: 'fake', model: 'fake-1', text: answerFrom(JSON.parse(toolMsg.content)), toolCalls: [], raw: {} };
    };
    fn.calls = calls;
    return fn;
  };

  it('answers HR questions from the same numbers as the dashboard', async () => {
    const w = await world();
    const gemini = toolThenAnswer('get_headcount', { department: 'engineering' }, (r) => `Engineering has ${r.headcount} active employees.`);
    setProviderOverride({ gemini });
    const res = (await as(w.hr).post('/api/ai/chat', { message: 'How many active employees are in Engineering?' }).expect(200)).body;
    expect(res).toMatchObject({ answer: 'Engineering has 2 active employees.', label: 'AI-generated', toolsUsed: ['get_headcount'] });
    expect(gemini.calls[0].tools).toContain('get_late_comers');
    expect(await AiLog.countDocuments({ kind: 'chat', ok: true, tools: 'get_headcount' })).toBe(1);
  });

  it('lists who is on leave today', async () => {
    const w = await world();
    setProviderOverride({ gemini: toolThenAnswer('get_leave_summary', {}, (r) => `On leave: ${r.onLeave.map((x) => x.employeeName).join(', ')}`) });
    const res = (await as(w.hr).post('/api/ai/chat', { message: 'Who is on leave today?' }).expect(200)).body;
    expect(res.answer).toBe('On leave: Bina Shah');
  });

  it('falls back from Gemini to Groq when Gemini is out of quota', async () => {
    const w = await world();
    setProviderOverride({
      gemini: async () => {
        throw new ProviderError('Quota exceeded', { status: 429, code: 'RATE_LIMITED' });
      },
      groq: toolThenAnswer('get_my_leave_balance', {}, (r) => `You have ${r.balances.find((x) => x.code === 'sick').remaining} sick days left.`),
    });
    const res = (await as(w.b.token).post('/api/ai/chat', { message: 'How many sick leaves do I have left this year?' }).expect(200)).body;
    expect(res).toMatchObject({ answer: 'You have 7 sick days left.', provider: 'fake' });
    expect(await AiLog.countDocuments({ fallbackUsed: true })).toBe(1);
  });

  it('gives employees only self-service tools; manager tools are refused even if called', async () => {
    const w = await world();
    const gemini = toolThenAnswer('get_payroll_summary', {}, (r) => JSON.stringify(r));
    setProviderOverride({ gemini });
    await as(w.a.token).post('/api/ai/chat', { message: "What is Bina's salary?" }).expect(200);
    expect(gemini.calls[0].tools).not.toContain('get_headcount');
    expect(gemini.calls[0].tools).not.toContain('get_late_comers');

    setProviderOverride({ gemini: toolThenAnswer('get_late_comers', {}, (r) => JSON.stringify(r)) });
    const sneaky = (await as(w.a.token).post('/api/ai/chat', { message: 'late comers?' }).expect(200)).body;
    expect(sneaky.answer).toContain('Not allowed');

    setProviderOverride({ gemini: toolThenAnswer('search_employees', { query: 'Bina' }, (r) => JSON.stringify(r)) });
    const search = (await as(w.a.token).post('/api/ai/chat', { message: 'find Bina' }).expect(200)).body;
    expect(search.answer).toContain('Ali Raza');
    expect(search.answer).not.toContain('Bina');
  });

  it('returns a friendly 503 when every provider fails', async () => {
    const w = await world();
    const down = async () => {
      throw new ProviderError('Server error', { status: 500 });
    };
    setProviderOverride({ gemini: down, groq: down });
    const res = await as(w.hr).post('/api/ai/chat', { message: 'hello' }).expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(await AiLog.countDocuments({ ok: false })).toBe(1);
  });

  it('smart leave turns a sentence into a pre-filled form and never saves', async () => {
    const w = await world();
    setProviderOverride({
      gemini: async ({ messages }) => {
        expect(messages[0].content).toContain('2026-03-09 Monday');
        return { provider: 'fake', model: 'f', text: '{"type":"casual","start":"2026-03-09","end":"2026-03-10","reason":"Sister\'s wedding"}', toolCalls: [], raw: {} };
      },
    });
    const res = (await as(w.a.token).post('/api/ai/smart-leave', { text: "I need next Monday and Tuesday off for my sister's wedding" }).expect(200)).body;
    expect(res).toMatchObject({ leaveTypeCode: 'casual', startDate: '2026-03-09', endDate: '2026-03-10', days: 2, label: 'AI-generated' });
    expect((await as(w.a.token).get('/api/leaves').expect(200)).body.total).toBe(0);
  });

  it('smart leave retries once, then asks for the normal form', async () => {
    const w = await world();
    let calls = 0;
    const bad = async () => {
      calls += 1;
      return { provider: 'fake', model: 'f', text: '{"type":"party","start":"tomorrow"}', toolCalls: [], raw: {} };
    };
    setProviderOverride({ gemini: bad });
    const res = await as(w.a.token).post('/api/ai/smart-leave', { text: 'some days off please' }).expect(422);
    expect(res.body.error.code).toBe('AI_PARSE_FAILED');
    expect(calls).toBe(2);
  });

  it('summarizes the dashboard in 3-5 bullets from the KPI JSON only', async () => {
    const w = await world();
    let sent = '';
    setProviderOverride({
      gemini: async ({ messages }) => {
        sent = messages[0].content;
        return { provider: 'fake', model: 'f', text: '{"bullets":["Attendance is 75%.","Bina Shah was late once.","One person is on sick leave today."]}', toolCalls: [], raw: {} };
      },
    });
    const res = (await as(w.hr).post('/api/ai/summary', { scope: 'hr', from: '2026-03-02', to: '2026-03-03' }).expect(200)).body;
    expect(res.bullets).toHaveLength(3);
    expect(sent).toContain('"attendanceRate":75');
    await as(w.a.token).post('/api/ai/summary', {}).expect(403);
  });
});

describe('announcements, notifications and audit log', () => {
  it('Admin/HR post announcements, everyone reads and gets notified', async () => {
    const w = await world();
    await as(w.a.token).post('/api/announcements', { title: 'Hi', body: 'Nope' }).expect(403);
    const a = (await as(w.hr).post('/api/announcements', { title: 'Eid holidays', body: 'Office closed for 3 days.' }).expect(201)).body;
    expect((await as(w.a.token).get('/api/announcements').expect(200)).body[0].title).toBe('Eid holidays');
    expect(await Announcement.countDocuments()).toBe(1);

    const notes = (await as(w.a.token).get('/api/notifications').expect(200)).body;
    expect(notes.items.some((n) => n.type === 'announcement')).toBe(true);
    expect(notes.unread).toBeGreaterThan(0);
    await as(w.a.token).post('/api/notifications/read-all').expect(204);
    expect((await as(w.a.token).get('/api/notifications').expect(200)).body.unread).toBe(0);
    expect(await Notification.countDocuments({ type: 'announcement' })).toBe(5); // everyone except the author

    await as(w.admin).delete(`/api/announcements/${a.id}`).expect(204);
  });

  it('only Admin reads the audit log, with filters', async () => {
    const w = await world();
    const all = (await as(w.admin).get('/api/audit-logs?limit=5').expect(200)).body;
    expect(all.total).toBeGreaterThan(5);
    const leaves = (await as(w.admin).get('/api/audit-logs?action=leave.').expect(200)).body;
    expect(leaves.items.map((x) => x.action).sort()).toEqual(['leave.apply', 'leave.approve']);
    await as(w.hr).get('/api/audit-logs').expect(403);
  });
});
