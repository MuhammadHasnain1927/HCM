import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MapPin, ScanFace, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import Modal from '../Modal.jsx';
import { Alert, Button, Spinner } from '../ui.jsx';
import FaceCamera from './FaceCamera.jsx';

const MAX_ACCURACY_M = 100;

/**
 * Face ID check-in / check-out: the camera waits for one face and a blink,
 * takes a photo and sends it with the location. The server stamps the time,
 * checks the office radius and asks the AI whether the face matches the
 * enrolled one.
 */
export default function FaceCheckModal({ mode = 'in', officeLocationSet, onClose, onSuccess }) {
  const needLocation = mode === 'in' && officeLocationSet;
  const [geo, setGeo] = useState({ state: needLocation ? 'locating' : 'skipped', coords: null, error: '' });
  const [phase, setPhase] = useState('camera'); // camera | verifying
  const [error, setError] = useState('');

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ state: 'error', coords: null, error: 'Location is not available in this browser.' });
      return;
    }
    setGeo((g) => ({ ...g, state: 'locating', error: '' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ state: 'ready', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, error: '' }),
      (err) => setGeo({ state: 'error', coords: null, error: err.code === 1 ? 'Location permission was denied. Allow it to check in.' : 'Could not get your location. Try again near a window.' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (needLocation) locate();
  }, [needLocation, locate]);

  const submit = async (photo) => {
    setPhase('verifying');
    setError('');
    try {
      const body = { photo, ...(mode === 'in' ? { source: 'camera', ...(geo.coords ?? {}) } : {}) };
      const { data } = await api.post(mode === 'in' ? '/attendance/check-in' : '/attendance/check-out', body, { timeout: 45000 });
      onSuccess(data);
    } catch (err) {
      const details = err?.response?.data?.error?.details;
      const code = err?.response?.data?.error?.code;
      setError(code === 'OUTSIDE_OFFICE' && details ? `You are ${details.distanceMeters} m from the office; ${mode === 'in' ? 'check-in' : 'check-out'} is allowed within ${details.radiusMeters} m.` : errorMessage(err));
      setPhase('camera');
    }
  };

  const accuracy = geo.coords?.accuracy ?? null;
  const geoOk = !needLocation || (geo.state === 'ready' && accuracy <= MAX_ACCURACY_M);
  const verb = mode === 'in' ? 'Check in' : 'Check out';

  return (
    <Modal
      open
      onClose={phase === 'verifying' ? undefined : onClose}
      title={`${verb} with Face ID`}
      description="Look at the camera and blink once. The photo is matched to your enrolled face by AI."
      footer={
        <Button variant="secondary" onClick={onClose} disabled={phase === 'verifying'}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <FaceCamera onCapture={submit} requireBlink autoCapture disabled={phase === 'verifying'} extraReady={geoOk} captureLabel={verb} />
          {phase === 'verifying' && (
            <div className="absolute inset-x-0 top-0 flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl bg-slate-900/70 text-sm text-white">
              <Spinner className="size-6 text-white" />
              Matching your face...
            </div>
          )}
        </div>

        {needLocation && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              {geo.state === 'locating' ? (
                <Spinner className="size-4" />
              ) : geoOk ? (
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
              ) : (
                <XCircle className="size-4 text-amber-600" aria-hidden />
              )}
              <span className="text-slate-700">
                {geo.state === 'locating'
                  ? 'Getting your location...'
                  : geo.state === 'error'
                    ? geo.error
                    : `Location accuracy about ${Math.round(accuracy)} m${geoOk ? '' : ` (needs ${MAX_ACCURACY_M} m or better)`}`}
              </span>
            </span>
            {(geo.state === 'error' || (geo.state === 'ready' && !geoOk)) && (
              <Button variant="secondary" className="px-3 py-1.5" onClick={locate}>
                <MapPin className="size-4" /> Try again
              </Button>
            )}
          </div>
        )}

        {error && (
          <Alert type="error">
            {error}
            <span className="mt-1 block text-xs">Blink again to retry.</span>
          </Alert>
        )}
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <ScanFace className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The time is recorded by the server. Can't check in? Request an attendance correction from HR.
        </p>
      </div>
    </Modal>
  );
}
