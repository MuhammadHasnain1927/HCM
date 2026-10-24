import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, Button, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, fieldErrors } from '../lib/api.js';
import { passwordProblem, PASSWORD_HINT } from '../lib/validation.js';

export default function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  const forced = user.mustChangePassword;

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!form.currentPassword) er.currentPassword = 'Current password is required';
    const pw = passwordProblem(form.newPassword);
    if (pw) er.newPassword = pw;
    else if (form.newPassword !== form.confirmPassword) er.confirmPassword = 'Passwords do not match';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSubmitting(true);
    setServerError('');
    try {
      await changePassword(form.currentPassword, form.newPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setServerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={forced ? 'Set your own password' : 'Change password'}
      subtitle={
        forced
          ? `Hi ${user.name.split(' ')[0]}, you signed in with a temporary password. Choose a new one to continue.`
          : 'Other devices will be signed out.'
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert type="error">{serverError}</Alert>
        <Input
          label={forced ? 'Temporary password' : 'Current password'}
          type="password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          error={errors.currentPassword}
          autoComplete="current-password"
          autoFocus
        />
        <Input
          label="New password"
          type="password"
          value={form.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
          hint={PASSWORD_HINT}
          autoComplete="new-password"
        />
        <Input
          label="Confirm new password"
          type="password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Save password
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" className="w-full" onClick={logout}>
            Sign out
          </Button>
        ) : (
          <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
