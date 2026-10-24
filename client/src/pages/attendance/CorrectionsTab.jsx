import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { REQUEST_STATUS, formatDay, timeAgo } from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Button, Card, EmptyState, Textarea } from '../../components/ui.jsx';

const FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];

function DecisionModal({ correction, decision, onClose, onDone }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const rejecting = decision === 'rejected';

  const submit = async (e) => {
    e.preventDefault();
    if (rejecting && !comment.trim()) {
      setError('Add a comment explaining the rejection');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/attendance/corrections/${correction.id}`, { decision, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      toast.success(rejecting ? 'Correction rejected.' : 'Correction approved and attendance updated.');
      onDone();
    } catch (err) {
      setError(fieldErrors(err).comment ?? errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title={rejecting ? 'Reject correction' : 'Approve correction'}
      description={`${correction.employeeName} · ${formatDay(correction.date)} · ${correction.checkIn}${correction.checkOut ? ` - ${correction.checkOut}` : ''}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="decision-form" variant={rejecting ? 'danger' : 'primary'} loading={saving}>
            {rejecting ? 'Reject' : 'Approve'}
          </Button>
        </>
      }
    >
      <form id="decision-form" onSubmit={submit} className="space-y-3" noValidate>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">"{correction.reason}"</p>
        <Textarea
          label={rejecting ? 'Comment (required)' : 'Comment (optional)'}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError('');
          }}
          error={error}
          maxLength={500}
        />
        {!rejecting && <p className="text-xs text-slate-500">Approving rebuilds this day's attendance from the requested times using the company rules.</p>}
      </form>
    </Modal>
  );
}

/** HR decides attendance corrections; Admin can view them (brief #11). */
export default function CorrectionsTab({ canDecide }) {
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useApi('/attendance/corrections', { params: status ? { status } : {} });
  const [deciding, setDeciding] = useState(null); // { correction, decision }

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (c) => (
        <div>
          <Link to={`/employees/${c.employeeId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
            {c.employeeName ?? 'Employee'}
          </Link>
          {c.employeeCode && <p className="text-xs text-slate-500">{c.employeeCode}</p>}
        </div>
      ),
    },
    { key: 'date', header: 'Day', className: 'whitespace-nowrap', render: (c) => formatDay(c.date) },
    { key: 'times', header: 'Requested', className: 'whitespace-nowrap', render: (c) => `${c.checkIn}${c.checkOut ? ` - ${c.checkOut}` : ''}` },
    { key: 'reason', header: 'Reason', render: (c) => <span className="line-clamp-2 max-w-xs">{c.reason}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <div>
          <Badge color={REQUEST_STATUS[c.status]?.color}>{REQUEST_STATUS[c.status]?.label ?? c.status}</Badge>
          <p className="mt-1 text-xs text-slate-500">{c.reviewComment ? `"${c.reviewComment}"` : `Sent ${timeAgo(c.createdAt)}`}</p>
        </div>
      ),
    },
    ...(canDecide
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'text-right',
            render: (c) =>
              c.status === 'pending' ? (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" className="px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50" onClick={() => setDeciding({ correction: c, decision: 'approved' })}>
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button variant="ghost" className="px-2.5 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeciding({ correction: c, decision: 'rejected' })}>
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            onClick={() => setStatus(f.value)}
            aria-pressed={status === f.value}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              status === f.value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={data}
        loading={loading}
        error={error}
        onRetry={reload}
        empty={
          <EmptyState icon={ClipboardCheck} title={status === 'pending' ? 'No pending corrections' : 'No corrections'}>
            {status === 'pending' ? 'All caught up. Correction requests from employees appear here.' : 'Nothing matches this filter.'}
          </EmptyState>
        }
      />
      {!canDecide && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">HR approves or rejects corrections. Admin can view them here.</p>}
      {deciding && (
        <DecisionModal
          correction={deciding.correction}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}
