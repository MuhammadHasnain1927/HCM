import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { KeyRound, UserCircle } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { EMPLOYEE_STATUS, formatDay, formatMoney } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/toast.jsx';
import { Badge, PageHeader } from '../components/data.jsx';
import { Alert, Button, Card, Input, Spinner, Textarea } from '../components/ui.jsx';
import { ROLE_LABELS } from '../config/navigation.js';

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || '—'}</dd>
    </div>
  );
}

/** Own profile: view everything, edit only phone and address (brief #06). */
export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, error, setData } = useApi(user.employeeId ? '/employees/me' : null);
  const [form, setForm] = useState({ phone: '', address: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm({ phone: data.phone ?? '', address: data.address ?? '' });
  }, [data]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const { data: saved } = await api.patch('/employees/me', { phone: form.phone.trim(), address: form.address.trim() });
      setData(saved);
      toast.success('Profile updated.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const status = data ? EMPLOYEE_STATUS[data.status] : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My profile"
        actions={
          <Link to="/change-password">
            <Button variant="secondary">
              <KeyRound className="size-4" /> Change password
            </Button>
          </Link>
        }
      />

      <Card className="mb-5 flex items-center gap-4 p-5">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <UserCircle className="size-8" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-slate-900">{user.name}</p>
          <p className="truncate text-sm text-slate-500">
            {user.email} · {ROLE_LABELS[user.role]}
          </p>
        </div>
      </Card>

      {!user.employeeId && <Alert type="info">Your login is not linked to an employee record. Ask HR to register you as an employee.</Alert>}
      {error && <Alert type="error">{error}</Alert>}
      {loading && !data && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner /> Loading...
        </div>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Job details</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee code" value={data.code} />
              <Field label="Status" value={status && <Badge color={status.color}>{status.label}</Badge>} />
              <Field label="Department" value={data.departmentName} />
              <Field label="Designation" value={data.designationTitle} />
              <Field label="Joined" value={formatDay(data.joinDate)} />
              <Field label="Gender" value={data.gender ? data.gender[0].toUpperCase() + data.gender.slice(1) : null} />
              <Field label="Date of birth" value={data.dateOfBirth ? formatDay(data.dateOfBirth, { weekday: false }) : null} />
              <Field label="Gross salary" value={data.salary ? `${formatMoney(data.salary.gross)} / month` : null} />
            </dl>
            <p className="mt-4 text-xs text-slate-500">To change job details, contact HR.</p>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Contact details</h2>
            <form onSubmit={save} className="space-y-4" noValidate>
              <Input label="Phone" type="tel" value={form.phone} maxLength={30} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} error={errors.phone} autoComplete="tel" />
              <Textarea label="Address" rows={3} maxLength={300} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} error={errors.address} autoComplete="street-address" />
              <Button type="submit" loading={saving} className="w-full">
                Save
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
