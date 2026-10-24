import { useState } from 'react';
import { CalendarDays, Pencil, Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Button, Card, EmptyState, Input } from '../../components/ui.jsx';

function LeaveTypeForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const isUnpaid = initial?.code === 'unpaid';
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    unlimited: initial ? initial.yearlyQuota === null : false,
    yearlyQuota: initial?.yearlyQuota != null ? String(initial.yearlyQuota) : '',
    isPaid: initial?.isPaid ?? true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (form.name.trim().length < 2) er.name = 'Name is required';
    const quota = form.unlimited ? null : Number(form.yearlyQuota);
    if (!form.unlimited && (form.yearlyQuota === '' || !Number.isInteger(quota) || quota < 0 || quota > 365)) {
      er.yearlyQuota = 'Whole days between 0 and 365';
    }
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    try {
      const body = { name: form.name.trim(), yearlyQuota: quota };
      if (!initial?.isSystem) body.isPaid = form.isPaid;
      if (initial) await api.patch(`/org/leave-types/${initial.id}`, body);
      else await api.post('/org/leave-types', body);
      toast.success(initial ? 'Leave type updated.' : 'Leave type added.');
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { name: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'Add leave type'}
      description={initial?.isSystem ? 'Built-in type: name and yearly quota can change.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="leave-type-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="leave-type-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Name"
          placeholder="e.g. Maternity leave"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
        />
        {!isUnpaid && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.unlimited}
                onChange={(e) => setForm((f) => ({ ...f, unlimited: e.target.checked }))}
                className="size-4 rounded border-slate-300 accent-brand-700"
              />
              No yearly limit
            </label>
            {!form.unlimited && (
              <Input
                label="Days per year"
                type="number"
                min="0"
                max="365"
                value={form.yearlyQuota}
                onChange={(e) => setForm((f) => ({ ...f, yearlyQuota: e.target.value }))}
                error={errors.yearlyQuota}
              />
            )}
          </>
        )}
        {!initial?.isSystem && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(e) => setForm((f) => ({ ...f, isPaid: e.target.checked }))}
              className="size-4 rounded border-slate-300 accent-brand-700"
            />
            Paid leave (no salary deduction)
          </label>
        )}
      </form>
    </Modal>
  );
}

export default function LeaveTypesTab({ canEdit }) {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useApi('/org/leave-types', { params: { includeArchived: showArchived } });
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const toggleActive = async (row) => {
    setBusyId(row.id);
    try {
      await api.patch(`/org/leave-types/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? `${row.name} archived.` : `${row.name} restored.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Leave type',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{r.name}</span>
          {r.isSystem && <Badge color="brand">Built-in</Badge>}
        </div>
      ),
    },
    { key: 'yearlyQuota', header: 'Days per year', render: (r) => (r.yearlyQuota === null ? 'Unlimited' : r.yearlyQuota) },
    { key: 'isPaid', header: 'Pay', render: (r) => (r.isPaid ? <Badge color="green">Paid</Badge> : <Badge color="amber">Unpaid</Badge>) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (r.isActive ? <Badge color="green">Active</Badge> : <Badge>Archived</Badge>),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-48 text-right',
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                  <Pencil className="size-4" />
                </Button>
                {!r.isSystem && (
                  <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => toggleActive(r)} loading={busyId === r.id}>
                    {r.isActive ? 'Archive' : 'Restore'}
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 rounded border-slate-300 accent-brand-700" />
          Show archived
        </label>
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add leave type
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={data}
        loading={loading}
        error={error}
        onRetry={reload}
        empty={<EmptyState icon={CalendarDays} title="No leave types" />}
      />
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        Leave counts working days only: weekends and public holidays are skipped. Unpaid leave is deducted from salary.
      </p>
      {editing && (
        <LeaveTypeForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}
