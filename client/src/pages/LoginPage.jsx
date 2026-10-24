import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, Button, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../lib/api.js';
import { isEmail } from '../lib/validation.js';

export default function LoginPage() {
  const { login, company } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!isEmail(email)) er.email = 'Enter a valid email';
    if (!password) er.password = 'Password is required';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSubmitting(true);
    setServerError('');
    try {
      const user = await login(email, password);
      const from = location.state?.from;
      navigate(user.mustChangePassword ? '/change-password' : from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle={company?.name ? `to ${company.name}` : 'to your HR workspace'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert type="error">{serverError}</Alert>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
          autoFocus
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          autoComplete="current-password"
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
        <p className="text-center text-xs text-slate-500">
          Forgot your password? Ask your Admin to reset it.
        </p>
      </form>
    </AuthShell>
  );
}
