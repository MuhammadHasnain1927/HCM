import { describe, expect, it } from 'vitest';
import { as, createOrg, registerEmployee, setupWithRoles } from './helpers.js';
import { setNow } from '../src/utils/clock.js';
import { env } from '../src/config/env.js';

// Calls the real Gemini / Groq APIs with the judges' questions (brief, Section 4).
// Skipped by default; run with:  LIVE_AI=1 npx vitest run tests/live-ai.test.js
const pkt = (date, time) => `${date}T${time}:00+05:00`;

describe.skipIf(!process.env.LIVE_AI)('live AI answers the judges\' questions', () => {
  it('answers from real data, refuses private data, and fills smart leave', async () => {
    const t = await setupWithRoles();
    const eng = await createOrg(t.admin);
    setNow(pkt('2026-03-02', '08:00'));
    const a = await registerEmployee(t.hr, eng, { name: 'Ali Raza', joinDate: '2026-01-01', basicSalary: 100000 });
    const b = await registerEmployee(t.hr, eng, { name: 'Bina Shah', joinDate: '2026-01-01', basicSalary: 80000 });
    setNow(pkt('2026-03-02', '09:05'));
    await as(a.token).post('/api/attendance/check-in').expect(201);
    setNow(pkt('2026-03-02', '09:45'));
    await as(b.token).post('/api/attendance/check-in').expect(201);
    setNow(pkt('2026-03-03', '08:30'));
    const types = Object.fromEntries((await as(b.token).get('/api/leaves/types').expect(200)).body.map((x) => [x.code, x.id]));
    const leave = (await as(b.token).post('/api/leaves', { leaveTypeId: types.sick, startDate: '2026-03-03', endDate: '2026-03-03' }).expect(201)).body;
    await as(t.hr).patch(`/api/leaves/${leave.id}/decision`, { decision: 'approved' }).expect(200);
    setNow(pkt('2026-03-03', '11:00'));

    const ask = async (token, message) => {
      const res = await as(token).post('/api/ai/chat', { message });
      console.log(`\nQ: ${message}\nA (${res.body.provider ?? res.status}): ${res.body.answer ?? JSON.stringify(res.body)}`);
      expect(res.status).toBe(200);
      return res.body.answer;
    };

    expect(await ask(t.hr, 'How many active employees are in Engineering?')).toMatch(/\b2\b|two/i);
    expect(await ask(t.hr, 'Who came late most often this month?')).toMatch(/Bina/);
    await ask(t.hr, "What is this month's attendance rate?");
    expect(await ask(t.hr, 'Who is on leave today?')).toMatch(/Bina/);
    expect(await ask(b.token, 'How many sick leaves do I have left this year?')).toMatch(/\b7\b|seven/i);
    const salary = await ask(a.token, "What is Bina's salary?");
    expect(salary).not.toMatch(/120,?000|80,?000/);
    expect(await ask(a.token, 'What time am I counted as late?')).toMatch(/9:15|09:15/);
    await ask(b.token, 'meri kitni sick leaves bachi hain?');

    const smart = await as(a.token).post('/api/ai/smart-leave', { text: "I need next Monday and Tuesday off for my sister's wedding" });
    console.log('\nSmart leave:', smart.status, JSON.stringify(smart.body));
    expect(smart.status).toBe(200);
    expect(smart.body).toMatchObject({ leaveTypeCode: 'casual', startDate: '2026-03-09', endDate: '2026-03-10', days: 2 });

    const summary = await as(t.hr).post('/api/ai/summary', { scope: 'hr' });
    console.log('\nSummary:', summary.status, JSON.stringify(summary.body.bullets ?? summary.body));
    expect(summary.status).toBe(200);

    // Force the Groq path once by hiding the Gemini key.
    const key = env.GEMINI_API_KEY;
    env.GEMINI_API_KEY = undefined;
    try {
      const viaGroq = await as(t.hr).post('/api/ai/chat', { message: 'How many active employees are there?' });
      console.log(`\nGroq only: ${viaGroq.status} ${viaGroq.body.provider} ${viaGroq.body.answer}`);
      expect(viaGroq.body.provider).toBe('groq');
      expect(viaGroq.body.answer).toMatch(/\b2\b|two/i);
    } finally {
      env.GEMINI_API_KEY = key;
    }
  }, 300000);
});
