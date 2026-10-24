import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, ShieldCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, Button, Input, Select } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, fieldErrors } from '../lib/api.js';
import { isEmail, passwordProblem, PASSWORD_HINT } from '../lib/validation.js';

function timezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Karachi', 'UTC'];
  }
}

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi';
  } catch {
    return 'Asia/Karachi';
  }
};

const STEPS = [
  { title: 'Company', icon: Building2 },
  { title: 'Admin account', icon: ShieldCheck },
];

export default function SetupPage() {
  const { completeSetup } = useAuth();
  const navigate = useNavigate();
  const zones = useMemo(timezones, []);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    companyName: '',
    timezone: browserTz(),
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validateCompany = () => {
    const er = {};
    if (form.companyName.trim().length < 2) er.companyName = 'Company name is required';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const validateAdmin = () => {
    const er = {};
    if (form.adminName.trim().length < 2) er.adminName = 'Your name is required';
    if (!isEmail(form.adminEmail)) er.adminEmail = 'Enter a valid email';
    const pw = passwordProblem(form.adminPassword);
    if (pw) er.adminPassword = pw;
    else if (form.adminPassword !== form.confirmPassword) er.confirmPassword = 'Passwords do not match';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const next = (e) => {
    e.preventDefault();
    if (validateCompany()) setStep(1);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateAdmin()) return;
    setSubmitting(true);
    setServerError('');
    try {
      const { confirmPassword: _ignored, ...payload } = form;
      await completeSetup(payload);
      navigate('/', { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (fe.companyName || fe.timezone) setStep(0);
      setServerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      wide
      title="Welcome! Let's set up your company"
      subtitle="This runs once. You'll create the company and the first Admin account."
    >
      <ol className="mb-6 flex items-center gap-2" aria-label="Setup steps">
        {STEPS.map(({ title, icon: Icon }, i) => (
          <li key={title} className="flex flex-1 items-center gap-2">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                i <= step ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500'
              }`}
              aria-current={i === step ? 'step' : undefined}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className={`text-sm font-medium ${i <= step ? 'text-slate-900' : 'text-slate-500'}`}>{title}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      <Alert type="error" className="mb-4">
        {serverError}
      </Alert>

      {step === 0 ? (
        <form onSubmit={next} className="space-y-4" noValidate>
          <Input
            label="Company name"
            placeholder="e.g. Acme Pvt Ltd"
            value={form.companyName}
            onChange={set('companyName')}
            error={errors.companyName}
            autoFocus
          />
          <Select label="Timezone" value={form.timezone} onChange={set('timezone')} error={errors.timezone}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            Office hours (09:00, 15 min grace), weekends (Sat-Sun) and the office location can be changed later in
            Organization settings.
          </p>
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Your full name" value={form.adminName} onChange={set('adminName')} error={errors.adminName} autoFocus autoComplete="name" />
          <Input
            label="Work email"
            type="email"
            value={form.adminEmail}
            onChange={set('adminEmail')}
            error={errors.adminEmail}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            value={form.adminPassword}
            onChange={set('adminPassword')}
            error={errors.adminPassword}
            hint={PASSWORD_HINT}
            autoComplete="new-password"
          />
          <Input
            label="Confirm password"
            type="password"
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={() => setStep(0)} disabled={submitting}>
              Back
            </Button>
            <Button type="submit" className="flex-1" loading={submitting}>
              Create company
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
