import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import { Alert, Button } from '../../components/ui.jsx';

/** Shows the result of registering one employee: the one-time temporary password, or a linked HR login. */
export default function CredentialsModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const { employee, login } = result;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(login.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Employee registered" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          <strong className="text-slate-900">{employee.name}</strong> ({employee.code}) was added to {employee.departmentName}.
        </p>
        {login.linkedExisting ? (
          <Alert type="success">
            This email already had an HR login, so it was linked to the new employee record. {employee.name} keeps signing in with their current password.
          </Alert>
        ) : (
          <>
            <dl className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{login.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Temporary password</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-white px-2 py-1 font-mono text-base text-slate-900 ring-1 ring-slate-200">{login.temporaryPassword}</code>
                  <Button variant="secondary" className="px-2.5 py-1.5" onClick={copy}>
                    {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </dd>
              </div>
            </dl>
            <Alert type="info">This password is shown only once. The employee must choose a new password the first time they sign in.</Alert>
          </>
        )}
      </div>
    </Modal>
  );
}
