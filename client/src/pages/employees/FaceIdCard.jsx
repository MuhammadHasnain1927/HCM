import { lazy, Suspense, useEffect, useState } from 'react';
import { ScanFace, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { formatDay } from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import { ConfirmDialog } from '../../components/Modal.jsx';
import { Badge } from '../../components/data.jsx';
import { Button, Card, Spinner } from '../../components/ui.jsx';

const FaceEnrollModal = lazy(() => import('../../components/face/FaceEnrollModal.jsx'));

/** The enrolled photo, fetched with the auth header (an <img src> cannot send it). */
function useFacePhoto(employeeId, version, enabled) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let objectUrl = null;
    let cancelled = false;
    api
      .get(`/employees/${employeeId}/face/photo`, { responseType: 'blob' })
      .then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, version, enabled]);
  return enabled ? url : null;
}

/** Employee 360: Face ID status, reference photo, enroll / re-enroll / reset (HR and Admin). */
export default function FaceIdCard({ employee, canManage, onChange }) {
  const toast = useToast();
  const status = useApi(`/employees/${employee.id}/face`);
  const [version, setVersion] = useState(0);
  const [enrolling, setEnrolling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const enrolled = Boolean(status.data?.enrolled);
  const photoUrl = useFacePhoto(employee.id, version, enrolled);
  const exited = employee.status === 'exited';

  const reset = async () => {
    setBusy(true);
    try {
      await api.delete(`/employees/${employee.id}/face`);
      toast.success('Face ID was reset. The employee sets it up again at the next check-in.');
      setResetting(false);
      status.reload();
      onChange?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ScanFace className="size-4.5 text-brand-700" aria-hidden /> Face ID
        </h2>
        {status.data && <Badge color={enrolled ? 'green' : 'amber'}>{enrolled ? 'Enrolled' : 'Not enrolled'}</Badge>}
      </div>

      {status.loading && !status.data ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Loading...
        </p>
      ) : enrolled ? (
        <div className="flex gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {photoUrl ? <img src={photoUrl} alt={`${employee.name}'s enrolled face`} className="size-full object-cover" /> : null}
          </div>
          <dl className="min-w-0 space-y-1 text-sm">
            <div>
              <dt className="inline text-slate-500">Enrolled: </dt>
              <dd className="inline text-slate-800">
                {formatDay(String(status.data.enrolledAt).slice(0, 10))} · {status.data.source === 'hr' ? 'by HR' : 'by the employee'}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Verified check-ins: </dt>
              <dd className="inline text-slate-800">{status.data.verifiedCount}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Refused attempts: </dt>
              <dd className={`inline ${status.data.failedCount ? 'font-medium text-amber-700' : 'text-slate-800'}`}>{status.data.failedCount}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-slate-600">No face enrolled yet. {canManage ? 'Enroll it now, or the employee sets it up at their first check-in.' : 'Set it up from the dashboard check-in card.'}</p>
      )}

      {canManage && !exited && status.data && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEnrolling(true)}>
            <ScanFace className="size-4" /> {enrolled ? 'Re-enroll' : 'Enroll face'}
          </Button>
          {enrolled && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setResetting(true)}>
              <Trash2 className="size-4" /> Reset
            </Button>
          )}
        </div>
      )}

      {enrolling && (
        <Suspense fallback={null}>
          <FaceEnrollModal
            employeeId={employee.id}
            employeeName={employee.name}
            replacing={enrolled}
            onClose={() => setEnrolling(false)}
            onEnrolled={() => {
              toast.success('Face enrolled.');
              setEnrolling(false);
              setVersion((v) => v + 1);
              status.reload();
              onChange?.();
            }}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={resetting}
        onClose={() => setResetting(false)}
        onConfirm={reset}
        loading={busy}
        danger
        title="Reset Face ID?"
        confirmLabel="Reset"
      >
        The enrolled photos are deleted. {employee.name} will enroll a new face at the next check-in.
      </ConfirmDialog>
    </Card>
  );
}
