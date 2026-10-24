import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Search, UserPlus, Users } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { isEmail } from '../lib/validation.js';
import { useToast } from '../components/toast.jsx';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { Badge, DataTable, PageHeader } from '../components/data.jsx';
import { Alert, Button, Card, EmptyState, Input } from '../components/ui.jsx';
import { ROLE_LABELS } from '../config/navigation.js';

const ROLE_COLORS = { admin: 'brand', hr: 'blue', employee: 'gray' };

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Shows a temporary password once, with a copy button. */
function TemporaryPasswordModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={result.title}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Share these sign-in details with <strong>{result.user.name}</strong>. They must choose a new password the first time they sign in.
        </p>
        <dl className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{result.user.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Temporary password</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="rounded bg-white px-2 py-1 font-mono text-base text-slate-900 ring-1 ring-slate-200">{result.temporaryPassword}</code>
              <Button variant="secondary" className="px-2.5 py-1.5" onClick={copy}>
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </dd>
          </div>
        </dl>
        <Alert type="info">This password is shown only once. If it is lost, reset the password again.</Alert>
      </div>
    </Modal>
  );
}

function CreateHrModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (form.name.trim().length < 2) er.name = 'Name is required';
    if (!isEmail(form.email)) er.email = 'Enter a valid email';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    setServerError('');
    try {
      const { data } = await api.post('/users/hr', { name: form.name.trim(), email: form.email.trim() });
      onCreated(data);
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
      onClose={onClose}
      title="Add HR login"
      description="HR registers employees, approves leave and prepares payroll."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="create-hr-form" loading={saving}>
            Create login
          </Button>
        </>
      }
    >
      <form id="create-hr-form" onSubmit={submit} className="space-y-4" noValidate>
        <Alert type="error">{serverError}</Alert>
        <Input label="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} autoComplete="off" />
        <Input
          label="Work email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          error={errors.email}
          autoComplete="off"
        />
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const [role, setRole] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi('/users', {
    params: { page, limit: 20, ...(role ? { role } : {}), ...(search ? { search } : {}) },
  });
  const [creating, setCreating] = useState(false);
  const [tempResult, setTempResult] = useState(null);
  const [confirm, setConfirm] = useState(null); // { type: 'status' | 'reset', user }
  const [busy, setBusy] = useState(false);

  // Debounce the search box so typing does not fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const runConfirmed = async () => {
    const { type, user } = confirm;
    setBusy(true);
    try {
      if (type === 'reset') {
        const { data: res } = await api.post(`/users/${user.id}/reset-password`);
        setTempResult({ ...res, title: 'Password reset' });
      } else if (type === 'role') {
        const role = user.role === 'hr' ? 'employee' : 'hr';
        await api.patch(`/users/${user.id}/role`, { role });
        toast.success(`${user.name} is now ${role === 'hr' ? 'HR' : 'an Employee'}. They need to sign in again.`);
      } else {
        await api.patch(`/users/${user.id}/status`, { isActive: !user.isActive });
        toast.success(user.isActive ? `${user.name} can no longer sign in.` : `${user.name} can sign in again.`);
      }
      setConfirm(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{u.name}</p>
          <p className="truncate text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          <Badge color={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
          {u.isOwner && <Badge color="gray">Owner</Badge>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) =>
        !u.isActive ? (
          <Badge color="red">Deactivated</Badge>
        ) : u.mustChangePassword ? (
          <Badge color="amber">Temporary password</Badge>
        ) : (
          <Badge color="green">Active</Badge>
        ),
    },
    { key: 'lastLoginAt', header: 'Last sign-in', className: 'whitespace-nowrap', render: (u) => formatDateTime(u.lastLoginAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (u) =>
        u.role === 'admin' ? null : (
          <div className="flex justify-end gap-1">
            {u.isActive && u.employeeId && (
              <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setConfirm({ type: 'role', user: u })} title={u.role === 'hr' ? 'Change to Employee' : 'Give HR access'}>
                {u.role === 'hr' ? 'Make employee' : 'Make HR'}
              </Button>
            )}
            {u.isActive && (
              <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setConfirm({ type: 'reset', user: u })} title="Reset password">
                <KeyRound className="size-4" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            )}
            <Button
              variant="ghost"
              className={`px-2.5 py-1.5 ${u.isActive ? 'text-red-600 hover:bg-red-50' : ''}`}
              onClick={() => setConfirm({ type: 'status', user: u })}
            >
              {u.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="User accounts"
        description="Sign-in accounts for HR and employees. Employee logins are created when HR registers an employee."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="size-4" /> Add HR login
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by role"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="hr">HR</option>
            <option value="employee">Employee</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={data?.items}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={
            <EmptyState icon={Users} title={search || role ? 'No matching accounts' : 'No accounts yet'}>
              {search || role ? 'Try a different search or filter.' : 'Add an HR login to get started.'}
            </EmptyState>
          }
        />

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {data.page} of {data.pages} · {data.total} accounts
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {creating && (
        <CreateHrModal
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false);
            setTempResult({ ...res, title: 'HR login created' });
            reload();
          }}
        />
      )}
      {tempResult && <TemporaryPasswordModal result={tempResult} onClose={() => setTempResult(null)} />}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmed}
        loading={busy}
        danger={confirm?.type === 'status' && confirm.user.isActive}
        key={confirm ? `${confirm.type}-${confirm.user.id}` : 'none'}
        title={
          confirm?.type === 'reset'
            ? 'Reset password?'
            : confirm?.type === 'role'
              ? confirm.user.role === 'hr'
                ? 'Change to Employee?'
                : 'Give HR access?'
              : confirm?.user.isActive
                ? 'Deactivate this account?'
                : 'Activate this account?'
        }
        confirmLabel={
          confirm?.type === 'reset' ? 'Reset password' : confirm?.type === 'role' ? 'Change role' : confirm?.user.isActive ? 'Deactivate' : 'Activate'
        }
      >
        {confirm?.type === 'role' && (
          <>
            <strong>{confirm.user.name}</strong> will {confirm.user.role === 'hr' ? 'lose HR access and become an Employee' : 'get HR access (employees, approvals, payroll drafts)'}. They will be signed out and must sign in again.
          </>
        )}
        {confirm?.type === 'reset' && (
          <>
            <strong>{confirm.user.name}</strong> will be signed out and get a new temporary password to change on next sign-in.
          </>
        )}
        {confirm?.type === 'status' &&
          (confirm.user.isActive ? (
            <>
              <strong>{confirm.user.name}</strong> will be signed out immediately and can no longer sign in. Their records are kept.
            </>
          ) : (
            <>
              <strong>{confirm.user.name}</strong> will be able to sign in again with their current password.
            </>
          ))}
      </ConfirmDialog>
    </div>
  );
}
