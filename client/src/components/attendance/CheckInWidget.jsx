import { lazy, Suspense, useEffect, useState } from 'react';
import { Camera, Clock, LogIn, LogOut, ScanFace } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { DAY_STATUS, formatDay, formatMinutes } from '../../lib/format.js';
import { useToast } from '../toast.jsx';
import { Badge } from '../data.jsx';
import { Alert, Button, Card, Spinner } from '../ui.jsx';

// The camera modal pulls in face detection, so it loads only when opened.
const CameraCheckInModal = lazy(() => import('./CameraCheckInModal.jsx'));
const FaceCheckModal = lazy(() => import('../face/FaceCheckModal.jsx'));
const FaceEnrollModal = lazy(() => import('../face/FaceEnrollModal.jsx'));

function addMinutes(hhmm, mins) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + (Number(mins) || 0);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Minutes since check-in, ticking every 30 s while the user is checked in. */
function useLiveMinutes(checkIn, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [active]);
  if (!checkIn) return null;
  return Math.max(0, Math.round((now - new Date(checkIn).getTime()) / 60000));
}

/**
 * Today's check-in card for HR and Employees (brief #09). The server stamps
 * the time; this only shows state and sends the action.
 */
export default function CheckInWidget({ onChange, className }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/attendance/today');
  const [busy, setBusy] = useState(null); // 'in' | 'out' | null
  const [cameraOpen, setCameraOpen] = useState(false);
  const [faceMode, setFaceMode] = useState(null); // 'in' | 'out' | 'enroll' | null

  const record = data?.record ?? null;
  const checkedIn = Boolean(record);
  const checkedOut = Boolean(record?.checkOut);
  const liveMinutes = useLiveMinutes(record?.checkIn, checkedIn && !checkedOut);

  const done = () => {
    reload();
    onChange?.();
  };

  const act = async (kind) => {
    setBusy(kind);
    try {
      const { data: rec } = await api.post(kind === 'in' ? '/attendance/check-in' : '/attendance/check-out', kind === 'in' ? { source: 'web' } : undefined);
      toast.success(kind === 'in' ? `Checked in at ${rec.checkInTime}${rec.status === 'late' ? ' (late)' : ''}.` : `Checked out at ${rec.checkOutTime}.`);
      done();
    } catch (err) {
      toast.error(errorMessage(err));
      reload();
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <Card className={`flex items-center gap-2 p-5 text-sm text-slate-500 ${className ?? ''}`}>
        <Spinner /> Loading today's attendance...
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card className={`p-5 ${className ?? ''}`}>
        <Alert type="error">
          {error}{' '}
          <button className="font-medium underline" onClick={reload}>
            Try again
          </button>
        </Alert>
      </Card>
    );
  }
  if (!data) return null;

  if (!data.hasEmployeeRecord) {
    return (
      <Card className={`p-5 ${className ?? ''}`}>
        <h2 className="text-base font-semibold text-slate-900">Today's attendance</h2>
        <Alert type="info" className="mt-3">
          No employee record is linked to your account yet. Ask HR to register you as an employee to check in.
        </Alert>
      </Card>
    );
  }

  const status = DAY_STATUS[data.status] ?? null;
  const lateAfter = addMinutes(data.officeStart, data.graceMinutes);
  const onLeave = data.status === 'on_leave';
  const worked = checkedOut ? record.workedMinutes : liveMinutes;

  return (
    <Card className={`p-5 sm:p-6 ${className ?? ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Today</p>
          <h2 className="mt-0.5 text-lg font-semibold text-slate-900">{formatDay(data.date)}</h2>
        </div>
        {status?.label && (
          <Badge color={status.color}>
            {checkedIn && !checkedOut ? `${status.label} · working` : status.label}
          </Badge>
        )}
      </div>

      {!data.workingDay && (
        <Alert type="info" className="mt-4">
          {data.holidayName ? `Today is a public holiday (${data.holidayName}).` : 'Today is a weekend.'} You can still check in if you are working.
        </Alert>
      )}
      {onLeave && (
        <Alert type="info" className="mt-4">
          You are on approved leave today.
        </Alert>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-slate-50 px-2 py-3">
          <dt className="text-xs text-slate-500">Check in</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{record?.checkInTime ?? '--:--'}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-3">
          <dt className="text-xs text-slate-500">Check out</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{record?.checkOutTime ?? '--:--'}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-3">
          <dt className="text-xs text-slate-500">Worked</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{worked === null || worked === undefined ? '-' : formatMinutes(worked)}</dd>
        </div>
      </dl>

      {record?.lateMinutes > 0 && <p className="mt-3 text-sm text-amber-700">Checked in {record.lateMinutes} minutes after office start.</p>}

      {data.faceRequired && !data.faceEnrolled && !checkedOut && (
        <Alert type="info" className="mt-4">
          Your company uses Face ID for attendance. Set up your face once, then check in by looking at the camera.
        </Alert>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {data.faceRequired && !data.faceEnrolled && !checkedOut && (
          <Button onClick={() => setFaceMode('enroll')} className="flex-1 sm:flex-none">
            <ScanFace className="size-4" /> Set up Face ID
          </Button>
        )}
        {data.faceRequired && data.faceEnrolled && !checkedIn && !onLeave && (
          <Button onClick={() => setFaceMode('in')} className="flex-1 sm:flex-none">
            <ScanFace className="size-4" /> Check in with Face ID
          </Button>
        )}
        {data.faceRequired && data.faceEnrolled && checkedIn && !checkedOut && (
          <Button onClick={() => setFaceMode('out')} className="flex-1 sm:flex-none">
            <ScanFace className="size-4" /> Check out with Face ID
          </Button>
        )}
        {!data.faceRequired && !checkedIn && !onLeave && (
          <>
            <Button onClick={() => act('in')} loading={busy === 'in'} className="flex-1 sm:flex-none">
              <LogIn className="size-4" /> Check in
            </Button>
            <Button variant="secondary" onClick={() => setCameraOpen(true)} disabled={Boolean(busy)} className="flex-1 sm:flex-none">
              <Camera className="size-4" /> Check in with camera
            </Button>
          </>
        )}
        {!data.faceRequired && checkedIn && !checkedOut && (
          <Button onClick={() => act('out')} loading={busy === 'out'} className="flex-1 sm:flex-none">
            <LogOut className="size-4" /> Check out
          </Button>
        )}
        {checkedOut && <p className="text-sm text-slate-600">You're done for today. See you tomorrow!</p>}
      </div>

      {lateAfter && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="size-3.5" aria-hidden /> Office starts {data.officeStart}; check-in after {lateAfter} counts as late. The server records the time.
        </p>
      )}

      {(faceMode === 'in' || faceMode === 'out') && (
        <Suspense fallback={null}>
          <FaceCheckModal
            mode={faceMode}
            officeLocationSet={data.officeLocationSet}
            onClose={() => setFaceMode(null)}
            onSuccess={(rec) => {
              const mode = faceMode;
              setFaceMode(null);
              toast.success(mode === 'in' ? `Face verified. Checked in at ${rec.checkInTime}${rec.status === 'late' ? ' (late)' : ''}.` : `Face verified. Checked out at ${rec.checkOutTime}.`);
              done();
            }}
          />
        </Suspense>
      )}
      {faceMode === 'enroll' && (
        <Suspense fallback={null}>
          <FaceEnrollModal
            onClose={() => setFaceMode(null)}
            onEnrolled={() => {
              toast.success('Face ID is set up. You can check in now.');
              setFaceMode(null);
              reload();
            }}
          />
        </Suspense>
      )}
      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraCheckInModal
            officeLocationSet={data.officeLocationSet}
            onClose={() => setCameraOpen(false)}
            onSuccess={(rec) => {
              setCameraOpen(false);
              toast.success(`Checked in with camera at ${rec.checkInTime}${rec.status === 'late' ? ' (late)' : ''}.`);
              done();
            }}
          />
        </Suspense>
      )}
    </Card>
  );
}
