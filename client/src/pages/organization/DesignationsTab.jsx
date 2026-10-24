import { useState } from 'react';
import { BadgeCheck, Pencil, Plus } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Button, Card, EmptyState, Input, Select } from '../../components/ui.jsx';

function DesignationForm({ initial, departments, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    departmentId: initial?.departmentId ?? departments[0]?.id ?? '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (form.title.trim().length < 2) er.title = 'Title is required';
    if (!form.departmentId) er.departmentId = 'Pick a department';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    try {
      const body = { title: form.title.trim(), departmentId: form.departmentId };
      if (initial) await api.patch(`/org/designations/${initial.id}`, body);
      else await api.post('/org/designations', body);
      toast.success(initial ? 'Designation updated.' : 'Designation added.');
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { title: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit designation' : 'Add designation'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="designation-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="designation-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Title"
          placeholder="e.g. Software Engineer"
          value={form.title}
          onChange={(e) => {
            setForm((f) => ({ ...f, title: e.target.value }));
            setErrors({});
          }}
          error={errors.title}
        />
        <Select
          label="Department"
          value={form.departmentId}
          onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          error={errors.departmentId}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </form>
    </Modal>
  );
}

export default function DesignationsTab({ canEdit }) {
  const toast = useToast();
  const [departmentId, setDepartmentId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const departments = useApi('/org/departments');
  const { data, loading, error, reload } = useApi('/org/designations', {
    params: { includeArchived: showArchived, ...(departmentId ? { departmentId } : {}) },
  });
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const activeDepartments = departments.data ?? [];
  const noDepartments = !departments.loading && activeDepartments.length === 0;

  const toggleActive = async (row) => {
    setBusyId(row.id);
    try {
      await api.patch(`/org/designations/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? `${row.title} archived.` : `${row.title} restored.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { key: 'title', header: 'Designation', render: (r) => <span className="font-medium text-slate-900">{r.title}</span> },
    { key: 'departmentName', header: 'Department' },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
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
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => toggleActive(r)} loading={busyId === r.id}>
                  {r.isActive ? 'Archive' : 'Restore'}
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
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {activeDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 rounded border-slate-300 accent-brand-700" />
            Show archived
          </label>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing('new')} disabled={noDepartments} title={noDepartments ? 'Add a department first' : undefined}>
            <Plus className="size-4" /> Add designation
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
          <EmptyState icon={BadgeCheck} title={noDepartments ? 'Add a department first' : 'No designations yet'}>
            {noDepartments
              ? 'Designations belong to a department. Create one in the Departments tab.'
              : 'Job titles such as Software Engineer or HR Officer, used when registering employees.'}
          </EmptyState>
        }
      />
      {editing && (
        <DesignationForm
          initial={editing === 'new' ? null : editing}
          departments={activeDepartments}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            departments.reload();
          }}
        />
      )}
    </Card>
  );
}
