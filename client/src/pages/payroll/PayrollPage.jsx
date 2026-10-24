import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, Lock, Play, Wallet } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { REQUEST_STATUS, currentMonth, formatDateTime, formatMoney, formatMonth } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, DataTable, PageHeader } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Input } from '../../components/ui.jsx';

function previousMonth() {
  const [y, m] = currentMonth().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

function RunPayrollModal({ runs, onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [month, setMonth] = useState(previousMonth());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = runs?.find((r) => r.month === month);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError('Pick a month');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/payroll/runs', { month });
      toast.success(`Payroll draft for ${formatMonth(month)} is ready.`);
      navigate(`/payroll/${data.id}`);
    } catch (err) {
      setError(fieldErrors(err).month ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title="Run payroll"
      description="Creates a draft from this month's attendance, leave and salary structures."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="run-payroll-form" loading={busy} disabled={existing?.status === 'finalized'}>
            {existing ? 'Recalculate draft' : 'Create draft'}
          </Button>
        </>
      }
    >
      <form id="run-payroll-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Month"
          type="month"
          max={currentMonth()}
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setError('');
          }}
          error={error}
        />
        {existing?.status === 'finalized' && (
          <Alert type="info">{formatMonth(month)} is already finalized and locked. It cannot be recalculated.</Alert>
        )}
        {existing?.status === 'draft' && <Alert type="info">A draft for {formatMonth(month)} already exists. It will be recalculated from current records.</Alert>}
      </form>
    </Modal>
  );
}

export default function PayrollPage() {
  const { user } = useAuth();
  const runs = useApi('/payroll/runs');
  const [running, setRunning] = useState(false);
  const isHr = user.role === 'hr';

  const columns = [
    {
      key: 'month',
      header: 'Month',
      render: (r) => (
        <Link to={`/payroll/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
          {formatMonth(r.month)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.status === 'finalized' && <Lock className="size-3.5 text-slate-400" aria-hidden />}
          <Badge color={REQUEST_STATUS[r.status].color}>{REQUEST_STATUS[r.status].label}</Badge>
        </span>
      ),
    },
    { key: 'employees', header: 'Employees', render: (r) => r.totals?.employees ?? 0 },
    { key: 'gross', header: 'Gross', className: 'whitespace-nowrap', render: (r) => formatMoney(r.totals?.gross) },
    { key: 'net', header: 'Net pay', className: 'whitespace-nowrap font-medium', render: (r) => formatMoney(r.totals?.net) },
    {
      key: 'when',
      header: 'Updated',
      className: 'whitespace-nowrap text-slate-500',
      render: (r) => (r.status === 'finalized' ? `Finalized ${formatDateTime(r.finalizedAt)}` : `Calculated ${formatDateTime(r.calculatedAt)}`),
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      className: 'w-10 text-right',
      render: (r) => (
        <Link to={`/payroll/${r.id}`} className="inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Open ${formatMonth(r.month)}`}>
          <ChevronRight className="size-4" />
        </Link>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Payroll"
        description={isHr ? 'Prepare the monthly payroll draft. Admin finalizes and locks it.' : 'Review payroll drafts prepared by HR and finalize them.'}
        actions={
          isHr && (
            <Button onClick={() => setRunning(true)}>
              <Play className="size-4" /> Run payroll
            </Button>
          )
        }
      />

      <Card className="mb-5 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">How pay is calculated</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Gross = 1.5 x basic salary (HRA 40% + medical 10% of basic).</li>
          <li>Per-day pay = gross / working days in the month. Deductions = per day x (absent + unpaid leave + 0.5 x half days). Joiners and leavers are prorated.</li>
          <li>Income tax uses the yearly slab on gross x 12, shown per month.</li>
          <li>HR creates and recalculates drafts; only Admin finalizes, and a finalized month is locked.</li>
        </ul>
      </Card>

      <Card>
        <DataTable
          columns={columns}
          rows={runs.data}
          loading={runs.loading}
          error={runs.error}
          onRetry={runs.reload}
          empty={
            <EmptyState
              icon={Wallet}
              title="No payroll runs yet"
              action={isHr && <Button onClick={() => setRunning(true)}>Run the first payroll</Button>}
            >
              {isHr ? 'Pick a month to calculate everyone\'s pay from attendance and leave.' : 'HR has not prepared a payroll draft yet.'}
            </EmptyState>
          }
        />
      </Card>

      {running && <RunPayrollModal runs={runs.data} onClose={() => setRunning(false)} />}
    </div>
  );
}
