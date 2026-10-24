import { useState } from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Button, Card, EmptyState, Input } from '../../components/ui.jsx';

function DepartmentForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: initial?.name ?? '', description: initial?.description ?? '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setErrors({ name: 'Name is required' });
      return;
    }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() };
      if (initial) await api.patch(`/org/departments/${initial.id}`, body);
      else await api.post('/org/departments', body);
      toast.success(initial ? 'Department updated.' : 'Department added.');
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe.name ? fe : { name: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit department' : 'Add department'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="department-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="department-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Department name"
          placeholder="e.g. Engineering"
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            setErrors({});
          }}
          error={errors.name}
        />
        <Input
          label="Description (optional)"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          error={errors.description}
        />
      </form>
    </Modal>
  );
}

export default function DepartmentsTab({ canEdit }) {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useApi('/org/departments', { params: { includeArchived: showArchived } });
  const [editing, setEditing] = useState(null); // null | 'new' | department
  const [busyId, setBusyId] = useState(null);

  const toggleActive = async (dept) => {
    setBusyId(dept.id);
    try {
      await api.patch(`/org/departments/${dept.id}`, { isActive: !dept.isActive });
      toast.success(dept.isActive ? `${dept.name} archived.` : `${dept.name} restored.`);
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
      header: 'Department',
      render: (d) => (
        <div>
          <p className="font-medium text-slate-900">{d.name}</p>
          {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
        </div>
      ),
    },
    { key: 'designationCount', header: 'Designations', className: 'w-32' },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
      render: (d) => (d.isActive ? <Badge color="green">Active</Badge> : <Badge>Archived</Badge>),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-48 text-right',
            render: (d) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => toggleActive(d)} loading={busyId === d.id}>
                  {d.isActive ? 'Archive' : 'Restore'}
                </Button>
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
            <Plus className="size-4" /> Add department
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={data}
        loading={loading}
        error={error}
        onRetry={reload}
        empty={
          <EmptyState
            icon={Building2}
            title="No departments yet"
            action={canEdit && <Button onClick={() => setEditing('new')}>Add the first department</Button>}
          >
            Employees are registered into departments, so add these first.
          </EmptyState>
        }
      />
      {editing && (
        <DepartmentForm
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
