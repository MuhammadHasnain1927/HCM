import { z } from 'zod';
import { AppError, unprocessable } from '../../utils/AppError.js';
import { addDays, dayOfWeek, daysBetween } from '../../utils/time.js';
import { isoDateSchema } from '../../utils/validators.js';
import { isManager } from '../../middleware/auth.js';
import { LeaveType } from '../../models/LeaveType.js';
import { AiLog } from '../../models/AiLog.js';
import { loadCalendar } from '../calendar.service.js';
import { adminDashboard, hrDashboard } from '../analytics.service.js';
import { countLeaveDays } from '../leave.service.js';
import { callProvider, configuredProviders, ProviderError } from './providers.js';
import { runTool, toolsFor } from './tools.js';

const TIMEOUT_MS = 15000;
const MAX_TOOL_ROUNDS = 4;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const AI_LABEL = 'AI-generated';

const unavailable = (message = 'The assistant is not available right now. Please try again in a moment.') =>
  new AppError(503, 'AI_UNAVAILABLE', message);

// ---------- Prompts ----------

/** Company rules (brief, Section 3) for policy Q&A, filled from live settings. */
function policyText(settings, leaveTypes) {
  const weekend = settings.weekendDays.map((d) => DAY_NAMES[d]).join(' and ') || 'none';
  const quotas = leaveTypes.map((t) => `${t.name}: ${t.yearlyQuota === null ? 'unlimited' : `${t.yearlyQuota} days/year`}${t.isPaid ? '' : ' (unpaid, deducted from salary)'}`).join('; ');
  return [
    `Office hours ${settings.officeStart}-${settings.officeEnd} (${settings.timezone}). Grace period ${settings.graceMinutes} minutes: checking in after ${addMinutes(settings.officeStart, settings.graceMinutes)} is late.`,
    `Working less than ${settings.halfDayHours} hours is a half day. No check-out means "missing checkout". A working day with no attendance record and no approved leave is absent.`,
    `Weekend: ${weekend}. Public holidays are not working days. One attendance record per employee per day; the server records the time.`,
    `Leave counts working days only (weekends and public holidays are skipped). Quotas: ${quotas}. Overlapping requests or requests above the remaining balance are refused. HR approves or rejects leave with a comment; employees can cancel pending leave or approved leave that has not started.`,
    'Attendance corrections: an employee requests one with a reason; HR approves or rejects it.',
    'Payroll: gross = 1.5 x basic (HRA 40% of basic, medical 10% of basic). Per-day pay = gross / working days in the month. Deductions = per-day pay x (absent days + unpaid leave days + 0.5 x half days). Joiners and leavers are paid for the days they were employed.',
    'Income tax uses yearly slabs on gross x 12: up to 600,000 no tax; up to 1,200,000: 5% of the amount over 600,000; up to 2,400,000: 30,000 + 15% over 1,200,000; up to 3,600,000: 210,000 + 25% over 2,400,000; above: 510,000 + 35% over 3,600,000. Monthly tax = yearly tax / 12.',
    'HR prepares the monthly payroll draft; only Admin finalizes it, and a finalized month is locked.',
    settings.latePenaltyEnabled ? 'Late penalty is ON: every 3 late days deduct half a day of pay.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

async function systemPrompt(user, cal) {
  const leaveTypes = await LeaveType.find({ isActive: true }).lean();
  const role = { admin: 'Admin (all company data)', hr: 'HR (HR data for all employees)', employee: 'Employee (only their own data)' }[user.role];
  return `You are the HCM Lite assistant for ${cal.settings.companyName}, an HR system.
Today is ${DAY_NAMES[dayOfWeek(cal.today)]} ${cal.today} (${cal.timezone}).
You are helping ${user.name}, signed in as ${role}.

Rules:
- The database is the only source of truth. For any number, list or fact about people, attendance, leave or payroll, call a tool and answer only from its result. Never guess or invent numbers, names or dates.
- Use the date ranges the user asks for (e.g. "this month" = first day of this month to today). Convert relative dates using today's date.
- Respect privacy: never reveal another employee's salary, payslip or personal data to someone who is not Admin or HR. If an Employee asks about a colleague's salary or private data, politely refuse and offer to help with their own data.
- If a tool returns an error or no data, say so plainly. If a question is outside HR data and the company rules below, say you don't know.
- For policy questions, answer only from the company rules below; if the answer is not there, say you don't know.
- Be brief and clear: 1-4 short sentences or a short list. Use the same units as the data (days, %, PKR).
- If the user writes in Roman Urdu, reply in Roman Urdu. Otherwise reply in English.
- You cannot change data. To apply for leave, tell the user to use the leave form (the smart leave box can fill it from a sentence).

Company rules:
${policyText(cal.settings, leaveTypes)}`;
}

// ---------- Provider fallback ----------

/** Runs `attempt(provider)` on Gemini, then Groq, within one shared deadline. */
async function withFallback(attempt) {
  const providers = configuredProviders();
  if (!providers.length) throw unavailable('The AI assistant is not configured. Add GEMINI_API_KEY or GROQ_API_KEY on the server.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const errors = [];
  try {
    for (const provider of providers) {
      if (controller.signal.aborted) break;
      try {
        const result = await attempt(provider, controller.signal);
        return { ...result, fallbackUsed: errors.length > 0, errors };
      } catch (err) {
        errors.push({ provider, message: err.message, code: err.code ?? 'ERROR' });
        if (!(err instanceof ProviderError) || err.retryable === false) throw err;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (errors.length && errors.every((e) => e.code === 'INVALID_JSON')) {
    throw new AppError(502, 'AI_INVALID_OUTPUT', 'The assistant gave an answer that could not be used. Please try again.');
  }
  const timedOut = controller.signal.aborted || errors.some((e) => e.code === 'TIMEOUT');
  const err = unavailable(timedOut ? 'The assistant took too long to answer. Please try again.' : undefined);
  err.providerErrors = errors;
  throw err;
}

async function logCall(user, kind, started, fields) {
  try {
    await AiLog.create({ user: user._id, role: user.role, kind, latencyMs: Date.now() - started, ...fields });
  } catch (err) {
    console.error('Failed to write ai_logs:', err.message);
  }
}

// ---------- Chat with tools ----------

const historySchema = z
  .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
  .max(12)
  .default([]);

export async function chat(user, { message, history = [] }) {
  const started = Date.now();
  const cal = await loadCalendar();
  const system = await systemPrompt(user, cal);
  const tools = toolsFor(user);
  const past = historySchema.parse(history).map((m) => ({ role: m.role, content: m.content }));

  try {
    const result = await withFallback(async (provider, signal) => {
      const messages = [...past, { role: 'user', content: message }];
      const used = [];
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const reply = await callProvider(provider, { system, messages, tools: round < MAX_TOOL_ROUNDS ? tools : [], signal });
        if (!reply.toolCalls.length) {
          if (!reply.text) throw new ProviderError('Empty answer', { code: 'EMPTY' });
          return { answer: reply.text, provider: reply.provider, model: reply.model, tools: used };
        }
        messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
        for (const call of reply.toolCalls) {
          used.push(call.name);
          const output = await runTool(user, call.name, call.args);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(output) });
        }
      }
      throw new ProviderError('Too many tool rounds', { code: 'TOOL_LOOP' });
    });
    await logCall(user, 'chat', started, { ok: true, provider: result.provider, model: result.model, tools: result.tools, fallbackUsed: result.fallbackUsed, question: message.slice(0, 300) });
    return { answer: result.answer, label: AI_LABEL, provider: result.provider, toolsUsed: [...new Set(result.tools)] };
  } catch (err) {
    await logCall(user, 'chat', started, { ok: false, errorCode: err.code ?? 'ERROR', question: message.slice(0, 300) });
    throw err;
  }
}

// ---------- JSON tasks (summary, smart leave) with validation + one retry ----------

async function jsonTask({ system, prompt, schema }) {
  return withFallback(async (provider, signal) => {
    let lastProblem = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was invalid (${lastProblem}). Reply again with only valid JSON in the required shape.`;
      const reply = await callProvider(provider, { system, messages: [{ role: 'user', content }], tools: [], json: true, signal });
      const parsed = schema.safeParse(extractJson(reply.text));
      if (parsed.success) return { data: parsed.data, provider: reply.provider, model: reply.model, retried: attempt > 0 };
      lastProblem = parsed.error.issues[0]?.message ?? 'wrong shape';
    }
    throw new ProviderError(`Invalid JSON from model: ${lastProblem}`, { code: 'INVALID_JSON' });
  });
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/** Dashboard summary (brief: 3-5 insight bullets using only the KPI numbers). */
export async function summarizeDashboard(user, { scope, from, to, departmentId }) {
  const started = Date.now();
  const useAdmin = scope === 'admin' && user.role === 'admin';
  const dashboard = useAdmin ? await adminDashboard(user, { from, to, departmentId }) : await hrDashboard(user, { from, to, departmentId });

  // Only the numbers shown on screen for the current filters are sent.
  const kpis = useAdmin
    ? { filters: dashboard.filters, kpis: dashboard.kpis, headcountByDepartment: dashboard.headcountByDepartment, payrollCostByDepartment: dashboard.payrollCostByDepartment, averageSalaryByDepartment: dashboard.averageSalaryByDepartment, gender: dashboard.gender, tenure: dashboard.tenure }
    : { filters: dashboard.filters, kpis: dashboard.kpis, absenteeismByDepartment: dashboard.absenteeismByDepartment, leaveByType: dashboard.leaveByType, topLateComers: dashboard.topLateComers, recentTrend: dashboard.attendanceTrend.slice(-10), insights: dashboard.insights };

  const schema = z.object({ bullets: z.array(z.string().min(5).max(300)).min(3, 'Give at least 3 bullets').max(5, 'Give at most 5 bullets') });
  try {
    const result = await jsonTask({
      system: 'You write short, factual HR dashboard summaries. Use only the numbers in the JSON you are given. Never invent numbers. If data is empty or zero, say so. Reply with JSON only.',
      prompt: `Write 3 to 5 insight bullets (each one sentence, under 30 words) for this ${useAdmin ? 'company' : 'HR'} dashboard. Mention the most important numbers, comparisons between departments and anything that needs attention.\nReturn exactly: {"bullets": ["...", "..."]}\n\nKPI JSON:\n${JSON.stringify(kpis)}`,
      schema,
    });
    await logCall(user, 'summary', started, { ok: true, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed });
    return { bullets: result.data.bullets, label: AI_LABEL, provider: result.provider, filters: dashboard.filters };
  } catch (err) {
    await logCall(user, 'summary', started, { ok: false, errorCode: err.code ?? 'ERROR' });
    throw err;
  }
}

/**
 * Smart leave: a sentence becomes {type, start, end, reason} that pre-fills the
 * leave form. The AI never saves anything; the user confirms (brief, Section 4).
 */
export async function smartLeave(user, { text }) {
  const started = Date.now();
  const cal = await loadCalendar();
  const types = await LeaveType.find({ isActive: true }).lean();
  const codes = types.map((t) => t.code);
  if (!codes.length) throw unprocessable('No leave types are set up yet. Ask your Admin.', 'NO_LEAVE_TYPES');
  const upcoming = Array.from({ length: 21 }, (_, i) => addDays(cal.today, i)).map((d) => `${d} ${DAY_NAMES[dayOfWeek(d)]}`).join('\n');

  const schema = z
    .object({
      type: z.enum(codes, { error: `type must be one of: ${codes.join(', ')}` }),
      // Real calendar dates only (the model can produce 2026-13-40).
      start: isoDateSchema,
      end: isoDateSchema,
      reason: z.string().max(300).default(''),
    })
    .refine((v) => v.end >= v.start, { message: 'end must be on or after start' })
    .refine((v) => daysBetween(v.start, v.end) <= 60, { message: 'a single request can cover at most 60 days' });

  try {
    const result = await jsonTask({
      system: 'You turn a leave request written in plain words (English or Roman Urdu) into JSON for a leave form. Reply with JSON only.',
      prompt: `Today is ${DAY_NAMES[dayOfWeek(cal.today)]} ${cal.today}. Calendar for the next 3 weeks:\n${upcoming}\n\n"Next Monday" means the first Monday after today. A single day means start = end.\nLeave types (use the code): ${types.map((t) => `${t.code} = ${t.name}`).join('; ')}.\nPick the type the user names; otherwise use sick for illness or a doctor, casual for personal or family matters (weddings, functions, errands), annual for vacation or travel, unpaid only if the user says unpaid.\nReturn exactly: {"type": "<code>", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": "<short reason in English>"}\n\nRequest: ${JSON.stringify(text)}`,
      schema,
    });
    const leaveType = types.find((t) => t.code === result.data.type);
    const days = await countLeaveDays(result.data.start, result.data.end);
    await logCall(user, 'smart_leave', started, { ok: true, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, question: text.slice(0, 300) });
    return {
      leaveTypeId: String(leaveType._id),
      leaveTypeCode: leaveType.code,
      leaveTypeName: leaveType.name,
      startDate: result.data.start,
      endDate: result.data.end,
      reason: result.data.reason,
      days,
      label: AI_LABEL,
    };
  } catch (err) {
    await logCall(user, 'smart_leave', started, { ok: false, errorCode: err.code ?? 'ERROR', question: text.slice(0, 300) });
    if (err.code === 'AI_INVALID_OUTPUT') {
      throw unprocessable("I couldn't understand that request. Please fill in the leave form instead.", 'AI_PARSE_FAILED');
    }
    throw err;
  }
}

export const canSummarize = (user) => isManager(user);
