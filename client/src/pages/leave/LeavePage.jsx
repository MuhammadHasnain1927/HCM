import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, Check, Inbox, Plus, Sparkles, X } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { REQUEST_STATUS, formatRange, timeAgo, todayIso } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/toast.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { Badge, DataTable, PageHeader, Tabs } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Input, Select, Textarea } from '../../components/ui.jsx';
import LeaveBalanceCards from '../../components/leave/LeaveBalanceCards.jsx';

const StatusBadge = ({ status }) => {
  const s = REQUEST_STATUS[status] ?? { label: status, color: 'gray' };
  return <Badge color={s.color}>{s.label}</Badge>;
};

const selectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100';

function Pager({ data, page, setPage, loading }) {
  if (!data || data.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        Page {data.page} of {data.pages} · {data.total} requests
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button variant="secondary" className="px-3 py-1.5" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------- Apply form (normal or pre-filled by smart leave) ----------

function ApplyLeaveModal({ initial, fromSmart, onClose, onSaved }) {
  const toast = useToast();
  const types = useApi('/leaves/types');
  const [form, setForm] = useState({
    leaveTypeId: initial?.leaveTypeId ?? '',
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
    reason: initial?.reason ?? '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({ days: initial?.days ?? null, loading: false });

  // Default to the first type once types load.
  useEffect(() => {
    if (!form.leaveTypeId && types.data?.length) setForm((f) => ({ ...f, leaveTypeId: types.data[0].id }));
  }, [types.data, form.leaveTypeId]);

  // Live working-day count (debounced).
  useEffect(() => {
    const { startDate, endDate } = form;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
      setPreview({ days: null, loading: false });
      return undefined;
    }
    let cancelled = false;
    setPreview((p) => ({ ...p, loading: true }));
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/leaves/preview', { params: { startDate, endDate } });
        if (!cancelled) setPreview({ days: data.days, loading: false });
      } catch {
        if (!cancelled) setPreview({ days: null, loading: false });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.startDate, form.endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Keep the end date sensible when the start date moves past it.
      if (field === 'startDate' && (!f.endDate || f.endDate < value)) next.endDate = value;
      return next;
    });
    setErrors((er) => ({ ...er, [field]: undefined }));
    setServerError('');
  };

  const selectedType = types.data?.find((t) => t.id === form.leaveTypeId);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!form.leaveTypeId) er.leaveTypeId = 'Pick a leave type';
    if (!form.startDate) er.startDate = 'Pick a start date';
    if (!form.endDate) er.endDate = 'Pick an end date';
    else if (form.startDate && form.endDate < form.startDate) er.endDate = 'Must be on or after the start date';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    setServerError('');
    try {
      await api.post('/leaves', {
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim() || undefined,
        ...(fromSmart ? { source: 'smart' } : {}),
      });
      toast.success('Leave request sent to HR.');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title="Apply for leave"
      description="Only working days are counted: weekends and public holidays are skipped."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="apply-leave-form" loading={saving}>
            Submit request
          </Button>
        </>
      }
    >
      <form id="apply-leave-form" onSubmit={submit} className="space-y-4" noValidate>
        {fromSmart && (
          <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-800">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>AI-generated</strong> - please check the type and dates before submitting.
            </p>
          </div>
        )}
        <Alert type="error">{serverError}</Alert>
        {types.error ? (
          <Alert type="error">{types.error}</Alert>
        ) : (
          <Select label="Leave type" value={form.leaveTypeId} onChange={set('leaveTypeId')} error={errors.leaveTypeId} disabled={types.loading}>
            {!types.data?.length && <option value="">Loading...</option>}
            {types.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.yearlyQuota === null ? 'unlimited' : `${t.yearlyQuota} days/year`}
                {t.isPaid ? '' : ', unpaid'})
              </option>
            ))}
          </Select>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} error={errors.startDate} />
          <Input label="End date" type="date" min={form.startDate || undefined} value={form.endDate} onChange={set('endDate')} error={errors.endDate} />
        </div>
        <p className="text-sm text-slate-600" aria-live="polite">
          {preview.loading
            ? 'Counting working days...'
            : preview.days === null
              ? 'Pick dates to see how many working days this takes.'
              : preview.days === 0
                ? 'These dates have no working days (weekends or holidays).'
                : `${preview.days} working day${preview.days === 1 ? '' : 's'}${selectedType && !selectedType.isPaid ? ' of unpaid leave (deducted from salary)' : ''}.`}
        </p>
        <Textarea
          label="Reason (optional)"
          value={form.reason}
          onChange={set('reason')}
          error={errors.reason}
          maxLength={500}
          placeholder="e.g. Family wedding"
        />
      </form>
    </Modal>
  );
}

// ---------- My leave tab ----------

function SmartLeaveBox({ onResult }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (text.trim().length < 5) {
      setError('Describe the leave you need in a few words.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/ai/smart-leave', { text: text.trim() });
      onResult({ ok: true, data });
      setText('');
    } catch (err) {
      // The server already retried once; fall back to the normal form.
      const message = errorMessage(err, "I couldn't understand that request. Please fill in the leave form instead.");
      setError(message);
      onResult({ ok: false, message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} noValidate>
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-lg bg-violet-50 p-1.5 text-violet-700">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">Smart leave</h2>
          <Badge color="gray">AI</Badge>
        </div>
        <Textarea
          label="Describe your leave in plain words"
          placeholder="Need next Monday and Tuesday off for my sister's wedding"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          rows={2}
          maxLength={500}
          error={error}
          hint="The assistant fills in the form for you. Nothing is sent to HR until you confirm."
        />
        <div className="mt-3 flex justify-end">
          <Button type="submit" loading={busy}>
            <Sparkles className="size-4" /> Fill the form
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MyLeaveTab() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const requests = useApi('/leaves', { params: { page, limit: 20 } });
  const [balanceKey, setBalanceKey] = useState(0);
  const [apply, setApply] = useState(null); // null | { initial, fromSmart }
  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const today = todayIso();

  const refresh = () => {
    requests.reload();
    setBalanceKey((k) => k + 1);
  };

  const confirmCancel = async () => {
    setCancelBusy(true);
    try {
      await api.patch(`/leaves/${cancelling.id}/cancel`);
      toast.success('Leave request cancelled.');
      setCancelling(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCancelBusy(false);
    }
  };

  const canCancel = (r) => r.status === 'pending' || (r.status === 'approved' && r.startDate > today);

  const columns = [
    {
      key: 'type',
      header: 'Leave',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.leaveTypeName}</p>
          <p className="text-xs text-slate-500">
            {r.days} day{r.days === 1 ? '' : 's'}
            {r.source === 'smart' ? ' · via smart leave' : ''}
          </p>
        </div>
      ),
    },
    { key: 'dates', header: 'Dates', className: 'whitespace-nowrap', render: (r) => formatRange(r.startDate, r.endDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.status} />
          {r.reviewComment && <p className="max-w-xs text-xs text-slate-500">"{r.reviewComment}"</p>}
        </div>
      ),
    },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 max-w-xs text-slate-600">{r.reason || '-'}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (r) =>
        canCancel(r) ? (
          <Button variant="ghost" className="px-2.5 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setCancelling(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <LeaveBalanceCards key={balanceKey} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SmartLeaveBox
            onResult={(res) => {
              if (res.ok) setApply({ initial: res.data, fromSmart: true });
              else setApply({ initial: null, fromSmart: false });
            }}
          />
        </div>
        <Card className="flex flex-col justify-between gap-4 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Prefer the form?</h2>
            <p className="mt-1 text-sm text-slate-500">Pick the leave type and dates yourself. HR reviews every request.</p>
          </div>
          <Button variant="secondary" onClick={() => setApply({ initial: null, fromSmart: false })}>
            <Plus className="size-4" /> Apply for leave
          </Button>
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">My requests</h2>
        </div>
        <DataTable
          columns={columns}
          rows={requests.data?.items}
          loading={requests.loading}
          error={requests.error}
          onRetry={requests.reload}
          empty={
            <EmptyState icon={CalendarDays} title="No leave requests yet">
              Your requests and HR's decisions will appear here.
            </EmptyState>
          }
        />
        <Pager data={requests.data} page={page} setPage={setPage} loading={requests.loading} />
      </Card>

      {apply && (
        <ApplyLeaveModal
          initial={apply.initial}
          fromSmart={apply.fromSmart}
          onClose={() => setApply(null)}
          onSaved={() => {
            setApply(null);
            setPage(1);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={confirmCancel}
        loading={cancelBusy}
        danger
        title="Cancel this leave request?"
        confirmLabel="Cancel request"
      >
        {cancelling && (
          <>
            Your <strong>{cancelling.leaveTypeName.toLowerCase()}</strong> for {formatRange(cancelling.startDate, cancelling.endDate)} will be
            cancelled and the days returned to your balance.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ---------- Approvals tab (HR) ----------

function DecisionModal({ leave, decision, onClose, onDone }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const approving = decision === 'approved';

  const submit = async (e) => {
    e.preventDefault();
    if (!approving && comment.trim().length === 0) {
      setError('Add a comment explaining the rejection.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/leaves/${leave.id}/decision`, { decision, comment: comment.trim() || undefined });
      toast.success(approving ? `Leave approved for ${leave.employeeName}.` : `Leave rejected for ${leave.employeeName}.`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={approving ? 'Approve leave' : 'Reject leave'}
      description={`${leave.employeeName} · ${leave.leaveTypeName} · ${formatRange(leave.startDate, leave.endDate)} (${leave.days} day${leave.days === 1 ? '' : 's'})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="leave-decision-form" variant={approving ? 'primary' : 'danger'} loading={busy}>
            {approving ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <form id="leave-decision-form" onSubmit={submit} className="space-y-4" noValidate>
        {leave.reason && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Reason: </span>
            {leave.reason}
          </p>
        )}
        <Textarea
          label={approving ? 'Comment (optional)' : 'Comment (required)'}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError('');
          }}
          maxLength={500}
          placeholder={approving ? 'e.g. Enjoy your time off' : 'e.g. Project deadline that week, please pick other dates'}
          error={error}
        />
      </form>
    </Modal>
  );
}

function ApprovalsTab() {
  const [page, setPage] = useState(1);
  const pending = useApi('/leaves', { params: { status: 'pending', page, limit: 20 } });
  const [deciding, setDeciding] = useState(null); // { leave, decision }

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.employeeName}</p>
          <p className="text-xs text-slate-500">{[r.employeeCode, r.departmentName].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      key: 'leave',
      header: 'Leave',
      render: (r) => (
        <div>
          <p className="text-slate-800">{r.leaveTypeName}</p>
          <p className="text-xs text-slate-500">
            {r.days} day{r.days === 1 ? '' : 's'}
            {r.isPaid === false ? ' · unpaid' : ''}
          </p>
        </div>
      ),
    },
    { key: 'dates', header: 'Dates', className: 'whitespace-nowrap', render: (r) => formatRange(r.startDate, r.endDate) },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 max-w-xs text-slate-600">{r.reason || '-'}</span> },
    { key: 'applied', header: 'Applied', className: 'whitespace-nowrap text-slate-500', render: (r) => timeAgo(r.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setDeciding({ leave: r, decision: 'approved' })}>
            <Check className="size-4 text-emerald-600" /> Approve
          </Button>
          <Button variant="ghost" className="px-2.5 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeciding({ leave: r, decision: 'rejected' })}>
            <X className="size-4" /> Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Waiting for a decision</h2>
        <p className="text-xs text-slate-500">Rejections need a comment. Your own requests must be decided by another HR member.</p>
      </div>
      <DataTable
        columns={columns}
        rows={pending.data?.items}
        loading={pending.loading}
        error={pending.error}
        onRetry={pending.reload}
        empty={
          <EmptyState icon={Inbox} title="All caught up">
            New leave requests will appear here.
          </EmptyState>
        }
      />
      <Pager data={pending.data} page={page} setPage={setPage} loading={pending.loading} />
      {deciding && (
        <DecisionModal
          leave={deciding.leave}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            pending.reload();
          }}
        />
      )}
    </Card>
  );
}

// ---------- All requests tab (Admin and HR) ----------

function AllRequestsTab() {
  const [filters, setFilters] = useState({ status: '', departmentId: '', leaveTypeId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const departments = useApi('/org/departments');
  const types = useApi('/leaves/types');
  const params = Object.fromEntries(Object.entries({ ...filters, page, limit: 20 }).filter(([, v]) => v !== ''));
  const list = useApi('/leaves', { params });

  const setFilter = (field) => (e) => {
    setFilters((f) => ({ ...f, [field]: e.target.value }));
    setPage(1);
  };
  const hasFilters = Object.values(filters).some(Boolean);

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.employeeName}</p>
          <p className="text-xs text-slate-500">{[r.employeeCode, r.departmentName].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (r) => r.leaveTypeName },
    { key: 'dates', header: 'Dates', className: 'whitespace-nowrap', render: (r) => formatRange(r.startDate, r.endDate) },
    { key: 'days', header: 'Days', className: 'w-16' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.status} />
          {r.reviewComment && <p className="max-w-xs text-xs text-slate-500">"{r.reviewComment}"</p>}
        </div>
      ),
    },
    { key: 'applied', header: 'Applied', className: 'whitespace-nowrap text-slate-500', render: (r) => timeAgo(r.createdAt) },
  ];

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-6">
        <select value={filters.status} onChange={setFilter('status')} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {REQUEST_STATUS[s].label}
            </option>
          ))}
        </select>
        <select value={filters.departmentId} onChange={setFilter('departmentId')} className={selectClass} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={filters.leaveTypeId} onChange={setFilter('leaveTypeId')} className={selectClass} aria-label="Filter by leave type">
          <option value="">All leave types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input type="date" value={filters.from} onChange={setFilter('from')} className={selectClass} aria-label="From date" />
        <input type="date" value={filters.to} min={filters.from || undefined} onChange={setFilter('to')} className={selectClass} aria-label="To date" />
        <Button
          variant="ghost"
          disabled={!hasFilters}
          onClick={() => {
            setFilters({ status: '', departmentId: '', leaveTypeId: '', from: '', to: '' });
            setPage(1);
          }}
        >
          Clear filters
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={
          <EmptyState icon={CalendarDays} title={hasFilters ? 'No matching requests' : 'No leave requests yet'}>
            {hasFilters ? 'Try different filters.' : 'Requests appear here as employees apply.'}
          </EmptyState>
        }
      />
      <Pager data={list.data} page={page} setPage={setPage} loading={list.loading} />
    </Card>
  );
}

// ---------- Page ----------

export default function LeavePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const tabs = [
    ...(user.role !== 'admin' ? [{ value: 'mine', label: 'My leave' }] : []),
    ...(user.role === 'hr' ? [{ value: 'approvals', label: 'Approvals' }] : []),
    ...(user.role !== 'employee' ? [{ value: 'all', label: 'All requests' }] : []),
  ];
  const defaultTab = user.role === 'employee' ? 'mine' : user.role === 'hr' ? 'approvals' : 'all';
  const requested = params.get('tab');
  const [tab, setTab] = useState(tabs.some((t) => t.value === requested) ? requested : defaultTab);

  const changeTab = (value) => {
    setTab(value);
    setParams({ tab: value }, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Leave"
        description={
          user.role === 'admin'
            ? 'Every leave request in the company. HR approves or rejects them.'
            : user.role === 'hr'
              ? 'Your own leave, the approval inbox and all requests.'
              : 'Your balance, new requests and HR decisions.'
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={changeTab} />}
      {tab === 'mine' && <MyLeaveTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'all' && <AllRequestsTab />}
    </div>
  );
}
