import { useState } from 'react';
import { CalendarHeart, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../components/toast.jsx';
import Modal, { ConfirmDialog } from '../../components/Modal.jsx';
import { DataTable } from '../../components/data.jsx';
import { Button, Card, EmptyState, Input } from '../../components/ui.jsx';

// Holidays are calendar days ("YYYY-MM-DD"); format them without timezone shifts.
const formatDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

function HolidayForm({ initial, year, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ date: initial?.date ?? '', name: initial?.name ?? '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) er.date = 'Pick a date';
    if (form.name.trim().length < 2) er.name = 'Name is required';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    try {
      const body = { date: form.date, name: form.name.trim() };
      if (initial) await api.patch(`/org/holidays/${initial.id}`, body);
      else await api.post('/org/holidays', body);
      toast.success(initial ? 'Holiday updated.' : 'Holiday added.');
      onSaved(form.date.slice(0, 4));
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { date: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit holiday' : 'Add public holiday'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="holiday-form" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="holiday-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Date"
          type="date"
          min={`${year - 1}-01-01`}
          value={form.date}
          onChange={(e) => {
            setForm((f) => ({ ...f, date: e.target.value }));
            setErrors({});
          }}
          error={errors.date}
        />
        <Input
          label="Name"
          placeholder="e.g. Independence Day"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
        />
      </form>
    </Modal>
  );
}

export default function HolidaysTab({ canEdit }) {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading, error, reload } = useApi('/org/holidays', { params: { year } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const confirmDelete = async () => {
    setDeletingBusy(true);
    try {
      await api.delete(`/org/holidays/${deleting.id}`);
      toast.success(`${deleting.name} removed.`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeletingBusy(false);
    }
  };

  const columns = [
    { key: 'date', header: 'Date', className: 'w-48 whitespace-nowrap', render: (h) => formatDay(h.date) },
    { key: 'name', header: 'Holiday', render: (h) => <span className="font-medium text-slate-900">{h.name}</span> },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-32 text-right',
            render: (h) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setEditing(h)} aria-label={`Edit ${h.name}`}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" className="px-2.5 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeleting(h)} aria-label={`Delete ${h.name}`}>
                  <Trash2 className="size-4" />
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
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="px-2 py-1.5" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-14 text-center text-sm font-semibold text-slate-900" aria-live="polite">
            {year}
          </span>
          <Button variant="ghost" className="px-2 py-1.5" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add holiday
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
          <EmptyState icon={CalendarHeart} title={`No holidays in ${year}`}>
            Public holidays are skipped when counting leave days and payroll working days.
          </EmptyState>
        }
      />
      {editing && (
        <HolidayForm
          initial={editing === 'new' ? null : editing}
          year={year}
          onClose={() => setEditing(null)}
          onSaved={(savedYear) => {
            setEditing(null);
            if (Number(savedYear) !== year) setYear(Number(savedYear));
            else reload();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deletingBusy}
        danger
        title="Remove this holiday?"
        confirmLabel="Remove"
      >
        {deleting && (
          <>
            <strong>{deleting.name}</strong> on {formatDay(deleting.date)} will become a normal working day.
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
