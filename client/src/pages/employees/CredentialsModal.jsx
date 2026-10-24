import { lazy, Suspense, useState } from 'react';
import { Check, CheckCircle2, Copy, ScanFace } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import { Alert, Button } from '../../components/ui.jsx';

const FaceEnrollModal = lazy(() => import('../../components/face/FaceEnrollModal.jsx'));

/** Shows the result of registering one employee: the one-time temporary password, or a linked HR login. */
export default function CredentialsModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [faceDone, setFaceDone] = useState(Boolean(result.employee.faceEnrolledAt));
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

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-4">
          <ScanFace className="size-6 shrink-0 text-brand-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">Face ID</p>
            <p className="text-xs text-slate-500">
              {faceDone
                ? 'Face enrolled. Check-ins will be matched to this face.'
                : 'Capture the face now so only this person can check in. Otherwise they set it up at their first check-in.'}
            </p>
          </div>
          {faceDone ? (
            <span className="flex items-center gap-1 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-4" /> Enrolled
            </span>
          ) : (
            <Button variant="secondary" onClick={() => setEnrolling(true)}>
              Capture face
            </Button>
          )}
        </div>
      </div>
      {enrolling && (
        <Suspense fallback={null}>
          <FaceEnrollModal
            employeeId={employee.id}
            employeeName={employee.name}
            onClose={() => setEnrolling(false)}
            onEnrolled={() => {
              setFaceDone(true);
              setEnrolling(false);
            }}
          />
        </Suspense>
      )}
    </Modal>
  );
}
