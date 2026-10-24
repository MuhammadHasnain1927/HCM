import { useState } from 'react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { todayIso } from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import Modal from '../../components/Modal.jsx';
import { Alert, Button, Input, Textarea } from '../../components/ui.jsx';

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Employee asks HR to fix a day's attendance (brief #11). */
export default function CorrectionRequestModal({ initialDate, initialCheckIn = '', initialCheckOut = '', onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ date: initialDate ?? todayIso(), checkIn: initialCheckIn, checkOut: initialCheckOut, reason: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!form.date) er.date = 'Pick a date';
    else if (form.date > todayIso()) er.date = 'Pick today or an earlier day';
    if (!form.checkIn) er.checkIn = 'Enter your check-in time';
    if (form.checkOut && form.checkIn && toMin(form.checkOut) <= toMin(form.checkIn)) er.checkOut = 'Must be after check-in';
    if (form.reason.trim().length < 3) er.reason = 'Explain what happened';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    setServerError('');
    try {
      await api.post('/attendance/corrections', {
        date: form.date,
        checkIn: form.checkIn,
        checkOut: form.checkOut || null,
        reason: form.reason.trim(),
      });
      toast.success('Correction sent to HR.');
      onSaved?.();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length || err.response?.status === 409) setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title="Request attendance correction"
      description="HR reviews the request; if approved, the day is rebuilt with these times."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="correction-form" loading={saving}>
            Send to HR
          </Button>
        </>
      }
    >
      <form id="correction-form" onSubmit={submit} className="space-y-4" noValidate>
        <Alert type="error">{serverError}</Alert>
        <Input label="Date" type="date" max={todayIso()} value={form.date} onChange={set('date')} error={errors.date} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Check-in time" type="time" value={form.checkIn} onChange={set('checkIn')} error={errors.checkIn} />
          <Input label="Check-out time (optional)" type="time" value={form.checkOut} onChange={set('checkOut')} error={errors.checkOut} />
        </div>
        <Textarea
          label="Reason"
          placeholder="e.g. Forgot to check out, internet was down"
          value={form.reason}
          onChange={set('reason')}
          error={errors.reason}
          maxLength={500}
        />
      </form>
    </Modal>
  );
}
