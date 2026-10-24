import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Download, Lock, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { blobErrorMessage, downloadFile } from '../../lib/download.js';
import { REQUEST_STATUS, formatDateTime, formatMoney, formatMonth } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/toast.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Spinner } from '../../components/ui.jsx';

/** Downloads a payslip PDF with a toast on failure. */
export function usePayslipDownload() {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const download = async (p) => {
    setBusyId(p.id);
    try {
      await downloadFile(`/payslips/${p.id}/pdf`, `payslip-${p.month}.pdf`);
    } catch (err) {
      toast.error(await blobErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };
  return { download, busyId };
}

function Row({ label, value, strong = false, muted = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className={muted ? 'text-slate-500' : 'text-slate-600'}>{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{value}</dd>
    </div>
  );
}

/** Every number on one payslip, with a PDF download. Shared with My payslips. */
export function PayslipDetailModal({ payslip: p, onClose }) {
  const { download, busyId } = usePayslipDownload();
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${p.employeeName} · ${formatMonth(p.month)}`}
      description={[p.employeeCode, p.departmentName, p.designationTitle].filter(Boolean).join(' · ')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => download(p)} loading={busyId === p.id}>
            <Download className="size-4" /> Download PDF
          </Button>
        </>
      }
    >
      {p.status === 'draft' && (
        <Alert type="info" className="mb-4">
          Draft: these numbers can still change until Admin finalizes the month.
        </Alert>
      )}
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">Earnings</h3>
          <dl className="divide-y divide-slate-100">
            <Row label="Basic" value={formatMoney(p.basic)} />
            <Row label="HRA (40%)" value={formatMoney(p.hra)} />
            <Row label="Medical (10%)" value={formatMoney(p.medical)} />
            <Row label="Gross" value={formatMoney(p.gross)} strong />
            {p.prorated && <Row label={`Earned (${p.employedDays} of ${p.workingDays} days)`} value={formatMoney(p.earned)} />}
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">Attendance</h3>
          <dl className="divide-y divide-slate-100">
            <Row label="Working days" value={p.workingDays} />
            <Row label="Absent days" value={p.absentDays} />
            <Row label="Unpaid leave days" value={p.unpaidLeaveDays} />
            <Row label="Half days (x 0.5)" value={p.halfDays} />
            {p.latePenaltyDays > 0 && <Row label={`Late penalty (${p.lateDays} late days)`} value={p.latePenaltyDays} />}
            <Row label="Per-day rate" value={formatMoney(p.perDay)} muted />
          </dl>
        </section>
      </div>
      <section className="mt-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">Deductions</h3>
        <dl className="divide-y divide-slate-100">
          <Row label={`Attendance (${p.deductionDays} day${p.deductionDays === 1 ? '' : 's'})`} value={formatMoney(p.deductions)} />
          <Row label={`Income tax (yearly slab on ${formatMoney(p.yearlyTaxableIncome)})`} value={formatMoney(p.tax)} />
        </dl>
      </section>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
        <span className="text-sm font-medium text-brand-800">Net pay</span>
        <span className="text-xl font-semibold text-brand-800">{formatMoney(p.net)}</span>
      </div>
    </Modal>
  );
}

function Stat({ label, value, strong = false }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${strong ? 'text-brand-800' : 'text-slate-900'}`}>{value}</p>
    </Card>
  );
}

export default function PayrollRunPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data: run, loading, error, reload, setData } = useApi(`/payroll/runs/${id}`);
  const [busy, setBusy] = useState(null); // 'recalc' | 'finalize'
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [selected, setSelected] = useState(null);
  const { download, busyId } = usePayslipDownload();

  const act = async (kind) => {
    setBusy(kind);
    try {
      const { data } = await api.post(`/payroll/runs/${id}/${kind === 'recalc' ? 'recalculate' : 'finalize'}`);
      setData(data);
      setConfirmFinalize(false);
      toast.success(kind === 'recalc' ? 'Payroll recalculated from the latest records.' : `${formatMonth(data.month)} payroll is finalized and locked.`);
    } catch (err) {
      if (err.response?.status === 423) {
        toast.error('This month is finalized and locked. It can no longer be changed.');
        reload();
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !run) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
        <Spinner /> Loading payroll...
      </div>
    );
  }
  if (error && !run) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert type="error">
          {error}{' '}
          <button className="font-medium underline" onClick={reload}>
            Try again
          </button>
        </Alert>
      </div>
    );
  }
  if (!run) return null;

  const finalized = run.status === 'finalized';
  const t = run.totals ?? {};

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (p) => (
        <button className="text-left" onClick={() => setSelected(p)}>
          <span className="block font-medium text-slate-900 hover:text-brand-700 hover:underline">{p.employeeName}</span>
          <span className="block text-xs text-slate-500">{p.employeeCode}{p.prorated ? ' · prorated' : ''}</span>
        </button>
      ),
    },
    { key: 'dept', header: 'Department', render: (p) => p.departmentName || '-' },
    { key: 'gross', header: 'Gross', className: 'whitespace-nowrap', render: (p) => formatMoney(p.gross) },
    { key: 'absent', header: 'Absent', className: 'text-center', render: (p) => p.absentDays },
    { key: 'unpaid', header: 'Unpaid', className: 'text-center', render: (p) => p.unpaidLeaveDays },
    { key: 'half', header: 'Half days', className: 'text-center', render: (p) => p.halfDays },
    { key: 'deductions', header: 'Deductions', className: 'whitespace-nowrap', render: (p) => formatMoney(p.deductions) },
    { key: 'tax', header: 'Tax', className: 'whitespace-nowrap', render: (p) => formatMoney(p.tax) },
    { key: 'net', header: 'Net', className: 'whitespace-nowrap font-semibold text-slate-900', render: (p) => formatMoney(p.net) },
    {
      key: 'pdf',
      header: <span className="sr-only">PDF</span>,
      className: 'text-right',
      render: (p) => (
        <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => download(p)} loading={busyId === p.id} aria-label={`Download payslip for ${p.employeeName}`}>
          <Download className="size-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/payroll" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> All payroll runs
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{formatMonth(run.month)} payroll</h1>
            <Badge color={REQUEST_STATUS[run.status].color}>
              {finalized && <Lock className="mr-1 size-3" aria-hidden />}
              {REQUEST_STATUS[run.status].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {run.workingDays} working days ·{' '}
            {finalized ? `Finalized ${formatDateTime(run.finalizedAt)} - locked` : `Calculated ${formatDateTime(run.calculatedAt)}`}
          </p>
        </div>
        {!finalized && (
          <div className="flex flex-wrap gap-2">
            {user.role === 'hr' && (
              <Button variant="secondary" onClick={() => act('recalc')} loading={busy === 'recalc'} disabled={Boolean(busy)}>
                <RefreshCw className="size-4" /> Recalculate
              </Button>
            )}
            {user.role === 'admin' && (
              <Button onClick={() => setConfirmFinalize(true)} disabled={Boolean(busy) || !t.employees}>
                <ShieldCheck className="size-4" /> Finalize
              </Button>
            )}
          </div>
        )}
      </div>

      {finalized ? (
        <Alert type="success" className="mb-5">
          This month is finalized. Payslips are visible to employees and nothing can be changed.
        </Alert>
      ) : (
        <Alert type="info" className="mb-5">
          {user.role === 'hr'
            ? 'Draft. Recalculate after attendance corrections or leave changes. Admin finalizes when it is correct.'
            : 'Draft prepared by HR. Review the numbers, then finalize to lock the month and release payslips.'}
        </Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Employees" value={t.employees ?? 0} />
        <Stat label="Gross" value={formatMoney(t.gross)} />
        <Stat label="Earned" value={formatMoney(t.earned)} />
        <Stat label="Deductions" value={formatMoney(t.deductions)} />
        <Stat label="Tax" value={formatMoney(t.tax)} />
        <Stat label="Net pay" value={formatMoney(t.net)} strong />
      </div>

      {run.skipped?.length > 0 && (
        <div className="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {run.skipped.length} employee{run.skipped.length === 1 ? ' was' : 's were'} skipped
            </p>
            <p>
              {run.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(', ')}.
              {run.skipped.some((s) => /salary/i.test(s.reason)) && " Set a salary structure in the employee's profile, then recalculate."}
            </p>
          </div>
        </div>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={run.payslips}
          empty={
            <EmptyState icon={Wallet} title="No payslips in this run">
              Only employees with a salary structure who were employed this month get a payslip.
            </EmptyState>
          }
        />
      </Card>

      {selected && <PayslipDetailModal payslip={selected} onClose={() => setSelected(null)} />}

      <ConfirmDialog
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={() => act('finalize')}
        loading={busy === 'finalize'}
        title={`Finalize ${formatMonth(run.month)}?`}
        confirmLabel="Finalize and lock"
      >
        This locks the month: payslips for <strong>{t.employees}</strong> employee{t.employees === 1 ? '' : 's'} (net {formatMoney(t.net)}) are released
        and nobody can recalculate or edit them afterwards.
      </ConfirmDialog>
    </div>
  );
}
