import { AppError } from '../../utils/AppError.js';
import { isManager } from '../../middleware/auth.js';
import * as analytics from '../analytics.service.js';
import { getBalancesFor, listLeaves, whoIsOnLeave } from '../leave.service.js';
import { payrollSummary } from '../payroll.service.js';
import { searchEmployees } from '../employees.service.js';
import { loadCalendar } from '../calendar.service.js';

/**
 * Tools the model may call (brief, Section 4). Each one calls the same
 * service functions as the REST API with the signed-in user, so the AI has
 * exactly that user's access. The model never touches the database.
 */

const dateParam = (what) => ({ type: 'string', description: `${what} as YYYY-MM-DD. Defaults to the current month so far.` });
const departmentParam = { type: 'string', description: 'Department name to filter by, e.g. "Engineering". Omit for the whole company.' };

const DEFINITIONS = {
  get_headcount: {
    managersOnly: true,
    description: 'Number of current (active + probation) employees, by status and by department.',
    parameters: { type: 'object', properties: { department: departmentParam } },
  },
  get_attendance_summary: {
    description:
      'Attendance rate, late %, absenteeism and day counts (present, late, half day, missing checkout, absent, on leave) for a date range, plus today\'s live numbers. Employees get only their own numbers.',
    parameters: { type: 'object', properties: { from: dateParam('Start date'), to: dateParam('End date'), department: departmentParam } },
  },
  get_late_comers: {
    managersOnly: true,
    description: 'Employees who came late most often in a date range, with their late-day counts.',
    parameters: {
      type: 'object',
      properties: { from: dateParam('Start date'), to: dateParam('End date'), department: departmentParam, limit: { type: 'integer', description: 'How many to return (1-20, default 5).' } },
    },
  },
  get_leave_summary: {
    description:
      'Leave overview: who is on approved leave on a given date (default today), approved leave days by type in a range, utilization and pending requests. Employees get only their own leave requests.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Day to list people on leave, YYYY-MM-DD (default today).' }, from: dateParam('Start date'), to: dateParam('End date'), department: departmentParam },
    },
  },
  get_my_leave_balance: {
    description: "The signed-in user's own leave balance per leave type for a year: quota, used (approved), pending and remaining.",
    parameters: { type: 'object', properties: { year: { type: 'integer', description: 'Year, default the current year.' } } },
  },
  get_payroll_summary: {
    description:
      'Payroll totals for a month (gross, deductions, tax, net, by department) for Admin/HR. For employees: only their own latest finalized payslip. Never returns another employee\'s salary.',
    parameters: { type: 'object', properties: { month: { type: 'string', description: 'Month as YYYY-MM (default latest run).' } } },
  },
  search_employees: {
    description: 'Find employees by name, code, email or phone. Returns directory details (no salaries). Employees can only find themselves.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for.' } }, required: ['query'] },
  },
};

/** Tool declarations for this user's role (managers-only tools are hidden from employees). */
export function toolsFor(user) {
  return Object.entries(DEFINITIONS)
    .filter(([, d]) => !d.managersOnly || isManager(user))
    .map(([name, d]) => ({ name, description: d.description, parameters: d.parameters }));
}

const departmentId = async (name) => (name ? analytics.resolveDepartment(name) : undefined);

const EXECUTORS = {
  async get_headcount(user, { department }) {
    return analytics.headcount({ departmentId: await departmentId(department) });
  },
  async get_attendance_summary(user, { from, to, department }) {
    return analytics.attendanceForAi(user, { from, to, department });
  },
  async get_late_comers(user, { from, to, department, limit }) {
    return analytics.lateComers({ from, to, departmentId: await departmentId(department), limit: Math.min(Math.max(Number(limit) || 5, 1), 20) });
  },
  async get_leave_summary(user, { date, from, to, department }) {
    const cal = await loadCalendar();
    if (!isManager(user)) {
      const mine = await listLeaves(user, { page: 1, limit: 20 });
      return { scope: 'own', requests: mine.items.map(({ leaveTypeName, startDate, endDate, days, status, reviewComment }) => ({ leaveTypeName, startDate, endDate, days, status, reviewComment })) };
    }
    const deptId = await departmentId(department);
    const day = date || cal.today;
    const [onLeave, summary] = await Promise.all([whoIsOnLeave({ date: day, departmentId: deptId }), analytics.leaveSummary({ from, to, departmentId: deptId })]);
    return { onLeaveDate: day, onLeave, onLeaveCount: onLeave.length, ...summary };
  },
  async get_my_leave_balance(user, { year }) {
    return getBalancesFor(user, { year: year ? Number(year) : undefined });
  },
  async get_payroll_summary(user, { month }) {
    return payrollSummary(user, { month: /^\d{4}-\d{2}$/.test(month ?? '') ? month : undefined });
  },
  async search_employees(user, { query }) {
    const rows = await searchEmployees(user, { query: String(query ?? '').slice(0, 100), limit: 10 });
    return rows.map(({ name, code, email, phone, departmentName, designationTitle, status, joinDate }) => ({ name, code, email, phone, departmentName, designationTitle, status, joinDate }));
  },
};

const MAX_RESULT_CHARS = 8000;

/** Runs a tool for the user. Errors become a short message the model can explain. */
export async function runTool(user, name, args) {
  const def = DEFINITIONS[name];
  const exec = EXECUTORS[name];
  if (!def || !exec) return { error: `Unknown tool ${name}` };
  if (def.managersOnly && !isManager(user)) return { error: 'Not allowed for this user' };
  try {
    const result = await exec(user, args ?? {});
    const text = JSON.stringify(result);
    return text.length > MAX_RESULT_CHARS ? { note: 'Result truncated', partial: text.slice(0, MAX_RESULT_CHARS) } : result;
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(`AI tool ${name} failed:`, err.message);
    return { error: 'This data could not be loaded right now.' };
  }
}
