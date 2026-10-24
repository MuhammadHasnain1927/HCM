import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RotateCcw,
  UserMinus,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { blobErrorMessage, downloadFile } from '../../lib/download.js';
import {
  EMPLOYEE_STATUS,
  REQUEST_STATUS,
  currentMonth,
  formatDateTime,
  formatDay,
  formatMoney,
  formatMonth,
  formatPercent,
  formatRange,
  todayIso,
} from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { Badge } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Input, Spinner, Textarea } from '../../components/ui.jsx';
import EmployeeFormModal, { salaryPreview } from './EmployeeFormModal.jsx';
import MonthGrid from './MonthGrid.jsx';
import FaceIdCard from './FaceIdCard.jsx';

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function Section({ icon: Icon, title, action, children, className = '' }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon className="size-4.5 text-brand-700" aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function SectionState({ loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Spinner /> Loading...
      </div>
    );
  }
  if (error) {
    return (
      <Alert type="error">
        {error}{' '}
        {onRetry && (
          <button className="font-medium underline" onClick={onRetry}>
            Try again
          </button>
        )}
      </Alert>
    );
  }
  return null;
}

function SalaryModal({ employee, onClose, onSaved }) {
  const toast = useToast();
  const [basic, setBasic] = useState(String(employee.salary?.basic || ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pay = salaryPreview(basic);

  const submit = async (e) => {
    e.preventDefault();
    const value = Number(basic);
    if (!basic || !Number.isFinite(value) || value <= 0) {
      setError('Enter a basic salary greater than 0');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put(`/employees/${employee.id}/salary`, { basic: value });
      toast.success('Salary structure updated.');
      onSaved(data);
    } catch (err) {
      setError(fieldErrors(err).basic ?? errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title="Salary structure"
      description="Used for payroll drafts created from now on. Finalized months do not change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="salary-form" loading={saving}>
            Save salary
          </Button>
        </>
      }
    >
      <form id="salary-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Basic salary (PKR / month)"
          type="number"
          min="1"
          inputMode="numeric"
          value={basic}
          onChange={(e) => {
            setBasic(e.target.value);
            setError('');
          }}
          error={error}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-4 text-sm" aria-live="polite">
          <dt className="text-slate-500">House rent (40%)</dt>
          <dd className="text-right">{formatMoney(pay.hra)}</dd>
          <dt className="text-slate-500">Medical (10%)</dt>
          <dd className="text-right">{formatMoney(pay.medical)}</dd>
          <dt className="font-medium text-slate-700">Gross (1.5 x basic)</dt>
          <dd className="text-right font-semibold">{formatMoney(pay.gross)}</dd>
        </dl>
      </form>
    </Modal>
  );
}

function ExitModal({ employee, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ exitDate: todayIso(), reason: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.exitDate)) {
      setErrors({ exitDate: 'Pick the last working day' });
      return;
    }
    if (form.exitDate < employee.joinDate) {
      setErrors({ exitDate: 'Must be on or after the join date' });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/employees/${employee.id}/exit`, { exitDate: form.exitDate, reason: form.reason.trim() || undefined });
      toast.success(`${employee.name} marked as exited.`);
      onSaved(data);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { exitDate: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title={`Mark ${employee.name} as exited`}
      description="Their login is deactivated immediately. Records are kept and the exit counts towards attrition."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="exit-form" loading={saving}>
            Mark as exited
          </Button>
        </>
      }
    >
      <form id="exit-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Last working day"
          type="date"
          min={employee.joinDate}
          value={form.exitDate}
          onChange={(e) => {
            setForm((f) => ({ ...f, exitDate: e.target.value }));
            setErrors({});
          }}
          error={errors.exitDate}
        />
        <Textarea
          label="Reason (optional)"
          rows={2}
          placeholder="e.g. Resigned, contract ended"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          error={errors.reason}
        />
      </form>
    </Modal>
  );
}

function InfoItem({ icon: Icon, label, children }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm text-slate-800">{children || '-'}</p>
      </div>
    </div>
  );
}

/** Employee 360 (brief #07): one person's profile, salary, attendance, leave and payslips. */
export default function Employee360Page() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user.role === 'hr' || user.role === 'admin';

  const employee = useApi(`/employees/${id}`);
  const [month, setMonth] = useState(currentMonth());
  const calendar = useApi('/attendance/calendar', { params: { month, employeeId: id } });
  const balance = useApi('/leaves/balance', { params: { employeeId: id } });
  const leaves = useApi('/leaves', { params: { employeeId: id, limit: 5, page: 1 } });
  const payslips = useApi('/payslips', { params: { employeeId: id } });

  const [editing, setEditing] = useState(false);
  const [editingSalary, setEditingSalary] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [reinstating, setReinstating] = useState(false);
  const [reinstateBusy, setReinstateBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  if (employee.loading && !employee.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <Spinner /> Loading employee...
      </div>
    );
  }
  if (employee.error && !employee.data) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card>
          <EmptyState
            icon={UserMinus}
            title={/not found|invalid id/i.test(employee.error) ? 'Employee not found' : 'Could not load this employee'}
            action={
              <div className="flex gap-2">
                <Link to="/employees">
                  <Button variant="secondary">Back to employees</Button>
                </Link>
                {!/not found|invalid id/i.test(employee.error) && <Button onClick={employee.reload}>Try again</Button>}
              </div>
            }
          >
            {employee.error}
          </EmptyState>
        </Card>
      </div>
    );
  }

  const e = employee.data;
  if (!e) return null;
  const status = EMPLOYEE_STATUS[e.status] ?? { label: e.status, color: 'gray' };
  const exited = e.status === 'exited';
  const counts = calendar.data?.counts;
  const rates = calendar.data?.rates;

  const reinstate = async () => {
    setReinstateBusy(true);
    try {
      const { data } = await api.patch(`/employees/${e.id}`, { status: 'active' });
      employee.setData(data);
      toast.success(`${e.name} reinstated. Their login works again.`);
      setReinstating(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReinstateBusy(false);
    }
  };

  const downloadSlip = async (slip) => {
    setDownloadingId(slip.id);
    try {
      await downloadFile(`/payslips/${slip.id}/pdf`, `payslip-${slip.month}.pdf`);
    } catch (err) {
      toast.error(await blobErrorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  };

  const initials = e.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link to="/employees" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Employees
      </Link>

      {/* Header */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-700 text-lg font-semibold text-white" aria-hidden>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{e.name}</h1>
              <Badge color={status.color}>{status.label}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {e.code}
              {e.designationTitle ? ` · ${e.designationTitle}` : ''}
              {e.departmentName ? ` · ${e.departmentName}` : ''}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem icon={Mail} label="Email">
                <a href={`mailto:${e.email}`} className="hover:text-brand-700 hover:underline">
                  {e.email}
                </a>
              </InfoItem>
              <InfoItem icon={Phone} label="Phone">
                {e.phone}
              </InfoItem>
              <InfoItem icon={Briefcase} label="Joined">
                {formatDay(e.joinDate)}
              </InfoItem>
              {exited && (
                <InfoItem icon={UserMinus} label="Exited">
                  {formatDay(e.exitDate)}
                  {e.exitReason ? ` · ${e.exitReason}` : ''}
                </InfoItem>
              )}
              <InfoItem icon={MapPin} label="Address">
                {e.address}
              </InfoItem>
              <InfoItem icon={CalendarDays} label="Date of birth">
                {e.dateOfBirth ? formatDay(e.dateOfBirth, { weekday: false }) : ''}
              </InfoItem>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit details
              </Button>
              {exited ? (
                <Button variant="secondary" onClick={() => setReinstating(true)}>
                  <RotateCcw className="size-4" /> Reinstate
                </Button>
              ) : (
                <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setExiting(true)}>
                  <UserMinus className="size-4" /> Mark as exited
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Attendance */}
        <Section
          icon={CalendarCheck}
          title="Attendance"
          className="lg:col-span-2"
          action={
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="px-2 py-1.5" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="w-32 text-center text-sm font-medium text-slate-700" aria-live="polite">
                {formatMonth(month)}
              </span>
              <Button variant="ghost" className="px-2 py-1.5" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonth()} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          }
        >
          <SectionState loading={calendar.loading && !calendar.data} error={!calendar.data && calendar.error} onRetry={calendar.reload} />
          {calendar.data && (
            <>
              {calendar.data.days.length ? (
                <MonthGrid days={calendar.data.days} />
              ) : (
                <p className="py-6 text-sm text-slate-500">No attendance for this month (not employed yet).</p>
              )}
              {counts && (
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center sm:grid-cols-6">
                  {[
                    ['Rate', formatPercent(rates?.attendanceRate)],
                    ['Present', counts.present + counts.late],
                    ['Late', counts.lateArrivals ?? counts.late],
                    ['Half day', counts.half_day],
                    ['Absent', counts.absent],
                    ['On leave', counts.on_leave],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </Section>

        {/* Salary */}
        <Section
          icon={Wallet}
          title="Salary structure"
          action={
            canManage &&
            !exited && (
              <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setEditingSalary(true)} aria-label="Edit salary">
                <Pencil className="size-4" />
              </Button>
            )
          }
        >
          {e.salary?.basic ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Basic</dt>
                <dd>{formatMoney(e.salary.basic)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">House rent (40%)</dt>
                <dd>{formatMoney(e.salary.hra)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Medical (10%)</dt>
                <dd>{formatMoney(e.salary.medical)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold text-slate-900">
                <dt>Gross / month</dt>
                <dd>{formatMoney(e.salary.gross)}</dd>
              </div>
              {e.salary.updatedAt && <p className="pt-1 text-xs text-slate-400">Updated {formatDateTime(e.salary.updatedAt)}</p>}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No salary set. Payroll skips employees without a salary structure.</p>
          )}
        </Section>

        <FaceIdCard employee={e} canManage={canManage} />

        {/* Leave */}
        <Section icon={CalendarDays} title={`Leave ${balance.data?.year ?? ''}`.trim()} className="lg:col-span-2">
          <SectionState loading={balance.loading && !balance.data} error={!balance.data && balance.error} onRetry={balance.reload} />
          {balance.data && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {balance.data.balances.map((b) => (
                <li key={b.leaveTypeId} className="rounded-lg border border-slate-200 p-3">
                  <p className="truncate text-xs font-medium text-slate-500">{b.name}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {b.quota === null ? b.used : b.remaining}
                    <span className="ml-1 text-xs font-normal text-slate-500">{b.quota === null ? 'used' : `of ${b.quota} left`}</span>
                  </p>
                  {b.pending > 0 && <p className="text-xs text-amber-700">{b.pending} pending</p>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 mt-5 text-sm font-medium text-slate-700">Recent requests</h3>
          <SectionState loading={leaves.loading && !leaves.data} error={!leaves.data && leaves.error} onRetry={leaves.reload} />
          {leaves.data &&
            (leaves.data.items.length ? (
              <ul className="divide-y divide-slate-100">
                {leaves.data.items.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">
                        {l.leaveTypeName} · {l.days} day{l.days === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatRange(l.startDate, l.endDate)}
                        {l.reason ? ` · ${l.reason}` : ''}
                      </p>
                    </div>
                    <Badge color={REQUEST_STATUS[l.status]?.color}>{REQUEST_STATUS[l.status]?.label ?? l.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No leave requests yet.</p>
            ))}
        </Section>

        {/* Payslips */}
        <Section icon={FileText} title="Payslips">
          <SectionState loading={payslips.loading && !payslips.data} error={!payslips.data && payslips.error} onRetry={payslips.reload} />
          {payslips.data &&
            (payslips.data.length ? (
              <ul className="divide-y divide-slate-100">
                {payslips.data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{formatMonth(p.month)}</p>
                      <p className="text-xs text-slate-500">
                        Net {formatMoney(p.net)} {p.status === 'draft' && <Badge color="amber">Draft</Badge>}
                      </p>
                    </div>
                    <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => downloadSlip(p)} loading={downloadingId === p.id} aria-label={`Download payslip for ${formatMonth(p.month)}`}>
                      <Download className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No payslips yet.</p>
            ))}
        </Section>
      </div>

      {editing && (
        <EmployeeFormModal
          employee={e}
          onClose={() => setEditing(false)}
          onSaved={(data) => {
            setEditing(false);
            employee.setData(data);
            toast.success('Employee details saved.');
          }}
        />
      )}
      {editingSalary && (
        <SalaryModal
          employee={e}
          onClose={() => setEditingSalary(false)}
          onSaved={(data) => {
            setEditingSalary(false);
            employee.setData(data);
          }}
        />
      )}
      {exiting && (
        <ExitModal
          employee={e}
          onClose={() => setExiting(false)}
          onSaved={(data) => {
            setExiting(false);
            employee.setData(data);
            calendar.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={reinstating}
        onClose={() => setReinstating(false)}
        onConfirm={reinstate}
        loading={reinstateBusy}
        title={`Reinstate ${e.name}?`}
        confirmLabel="Reinstate"
      >
        Their status becomes Active, the exit date is cleared and their login can sign in again.
      </ConfirmDialog>
    </div>
  );
}
