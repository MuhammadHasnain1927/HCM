import { useEffect, useState } from 'react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { formatMoney, todayIso } from '../../lib/format.js';
import { isEmail } from '../../lib/validation.js';
import Modal from '../../components/Modal.jsx';
import { Alert, Button, Input, Select, Textarea } from '../../components/ui.jsx';

/** Salary breakdown shown while typing (server rule: gross = 1.5 x basic, HRA 40%, medical 10%). */
export function salaryPreview(basic) {
  const b = Number(basic) || 0;
  return { basic: b, hra: b * 0.4, medical: b * 0.1, gross: b * 1.5 };
}

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  gender: '',
  dateOfBirth: '',
  departmentId: '',
  designationId: '',
  joinDate: todayIso(),
  basicSalary: '',
  status: 'active',
  code: '',
};

const fromEmployee = (e) => ({
  name: e.name ?? '',
  email: e.email ?? '',
  phone: e.phone ?? '',
  address: e.address ?? '',
  gender: e.gender ?? '',
  dateOfBirth: e.dateOfBirth ?? '',
  departmentId: e.departmentId ?? '',
  designationId: e.designationId ?? '',
  joinDate: e.joinDate ?? '',
  basicSalary: String(e.salary?.basic ?? ''),
  status: e.status === 'exited' ? 'active' : e.status,
  code: e.code ?? '',
});

/**
 * Register (no `employee`) or edit (with `employee`) form.
 * onSaved(result): register -> { employee, login }, edit -> employee.
 */
export default function EmployeeFormModal({ employee, onClose, onSaved }) {
  const editing = Boolean(employee);
  const [form, setForm] = useState(editing ? fromEmployee(employee) : emptyForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);
  const departments = useApi('/org/departments');
  const designations = useApi(form.departmentId ? '/org/designations' : null, { params: { departmentId: form.departmentId } });

  // Pick the first department by default for new employees.
  useEffect(() => {
    if (!editing && !form.departmentId && departments.data?.length) {
      setForm((f) => ({ ...f, departmentId: departments.data[0].id }));
    }
  }, [departments.data, editing, form.departmentId]);

  const set = (field) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value, ...(field === 'departmentId' ? { designationId: '' } : {}) }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (form.name.trim().length < 2) er.name = 'Name is required';
    if (!isEmail(form.email)) er.email = 'Enter a valid email';
    if (!form.departmentId) er.departmentId = 'Pick a department';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.joinDate)) er.joinDate = 'Pick the join date';
    if (form.code && !/^[A-Za-z0-9-]{2,20}$/.test(form.code.trim())) er.code = 'Use 2-20 letters, digits or dashes';
    if (!editing) {
      const salary = Number(form.basicSalary);
      if (!form.basicSalary || !Number.isFinite(salary) || salary <= 0) er.basicSalary = 'Enter a basic salary greater than 0';
    }
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setServerError('');
    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      gender: form.gender || null,
      dateOfBirth: form.dateOfBirth || null,
      departmentId: form.departmentId,
      designationId: form.designationId || null,
      joinDate: form.joinDate,
      status: form.status,
      code: form.code.trim() || undefined,
    };
    try {
      if (editing) {
        const { data } = await api.patch(`/employees/${employee.id}`, body);
        onSaved(data);
      } else {
        const { data } = await api.post('/employees', { ...body, basicSalary: Number(form.basicSalary) });
        onSaved(data);
      }
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const pay = salaryPreview(form.basicSalary);
  const noDepartments = !departments.loading && !departments.data?.length;

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      size="lg"
      title={editing ? `Edit ${employee.name}` : 'Register employee'}
      description={editing ? 'Changes are saved to the audit log.' : 'This also creates the employee’s login with a temporary password.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" loading={saving} disabled={noDepartments}>
            {editing ? 'Save changes' : 'Register employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="space-y-5" noValidate>
        <Alert type="error">{serverError}</Alert>
        {noDepartments && <Alert type="info">Admin needs to add a department first (Organization → Departments).</Alert>}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Personal details</legend>
          <Input label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="off" />
          <Input label="Work email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off" />
          <Input label="Phone (optional)" value={form.phone} onChange={set('phone')} error={errors.phone} inputMode="tel" />
          <Select label="Gender (optional)" value={form.gender} onChange={set('gender')} error={errors.gender}>
            <option value="">Not specified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </Select>
          <Input label="Date of birth (optional)" type="date" max={todayIso()} value={form.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth} />
          <Input
            label="Employee code (optional)"
            placeholder="Auto: EMP-0001"
            value={form.code}
            onChange={set('code')}
            error={errors.code}
            hint={editing ? undefined : 'Leave empty to number automatically.'}
          />
          <Textarea className="sm:col-span-2" label="Address (optional)" rows={2} value={form.address} onChange={set('address')} error={errors.address} />
        </fieldset>

        <fieldset className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <legend className="sr-only">Job details</legend>
          <Select label="Department" value={form.departmentId} onChange={set('departmentId')} error={errors.departmentId} disabled={departments.loading}>
            {!form.departmentId && <option value="">Select a department</option>}
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select label="Designation (optional)" value={form.designationId} onChange={set('designationId')} error={errors.designationId} disabled={!form.departmentId || designations.loading}>
            <option value="">No designation</option>
            {(designations.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
          <Input label="Join date" type="date" value={form.joinDate} onChange={set('joinDate')} error={errors.joinDate} />
          <Select label="Status" value={form.status} onChange={set('status')} error={errors.status}>
            <option value="active">Active</option>
            <option value="probation">Probation</option>
          </Select>
        </fieldset>

        {!editing && (
          <fieldset className="border-t border-slate-100 pt-5">
            <legend className="sr-only">Salary</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Basic salary (PKR / month)"
                type="number"
                min="1"
                inputMode="numeric"
                value={form.basicSalary}
                onChange={set('basicSalary')}
                error={errors.basicSalary}
              />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
                <dt className="text-slate-500">HRA (40%)</dt>
                <dd className="text-right text-slate-800">{formatMoney(pay.hra)}</dd>
                <dt className="text-slate-500">Medical (10%)</dt>
                <dd className="text-right text-slate-800">{formatMoney(pay.medical)}</dd>
                <dt className="font-medium text-slate-700">Gross</dt>
                <dd className="text-right font-semibold text-slate-900">{formatMoney(pay.gross)}</dd>
              </dl>
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
