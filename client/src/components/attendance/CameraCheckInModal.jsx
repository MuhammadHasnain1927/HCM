import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, MapPin, ScanFace, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import Modal from '../Modal.jsx';
import { Alert, Button, Spinner } from '../ui.jsx';

const DETECT_EVERY_MS = 400;
const MAX_ACCURACY_M = 100;

// face-api is large; load it (and the tiny detector model) only once, on demand.
let faceApiPromise = null;
function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api').then(async (faceapi) => {
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      return faceapi;
    });
    faceApiPromise.catch(() => {
      faceApiPromise = null;
    });
  }
  return faceApiPromise;
}

function StepRow({ ok, pending, label, detail }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {pending ? (
        <Spinner className="mt-0.5 size-4" />
      ) : ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
      )}
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {detail && <span className="block text-xs text-slate-500">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * Camera attendance (brief, Section 5 bonus): exactly one face in the frame and
 * a GPS position. The phone only sends data; the server checks the distance to
 * the office and decides. No photo leaves the device.
 */
export default function CameraCheckInModal({ onClose, onSuccess, officeLocationSet = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraState, setCameraState] = useState('starting'); // starting | ready | error
  const [cameraError, setCameraError] = useState('');
  const [modelState, setModelState] = useState('loading'); // loading | ready | error
  const [faceCount, setFaceCount] = useState(null);
  const [geo, setGeo] = useState({ state: 'locating', coords: null, error: '' });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  // Camera
  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraError('This browser cannot open the camera.');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setCameraState('error');
        setCameraError(err?.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'The camera could not be opened.');
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Face detection model
  useEffect(() => {
    let cancelled = false;
    loadFaceApi()
      .then(() => !cancelled && setModelState('ready'))
      .catch(() => !cancelled && setModelState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Detection loop
  useEffect(() => {
    if (cameraState !== 'ready' || modelState !== 'ready') return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        if (video.readyState >= 2) {
          const faceapi = await loadFaceApi();
          const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
          if (!stopped) setFaceCount(detections.length);
        }
      } catch {
        /* a missed frame is fine; try again */
      }
      if (!stopped) timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [cameraState, modelState]);

  // Location
  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ state: 'error', coords: null, error: 'Location is not available in this browser.' });
      return;
    }
    setGeo((g) => ({ ...g, state: 'locating', error: '' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ state: 'ready', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, error: '' }),
      (err) =>
        setGeo({
          state: 'error',
          coords: null,
          error: err.code === 1 ? 'Location permission was denied.' : 'Could not get your location. Try again near a window.',
        }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  const oneFace = faceCount === 1;
  const accuracy = geo.coords?.accuracy ?? null;
  const accuracyOk = accuracy !== null && accuracy <= MAX_ACCURACY_M;
  const canSubmit = oneFace && geo.state === 'ready' && officeLocationSet && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setServerError('');
    try {
      const { data } = await api.post('/attendance/check-in', {
        source: 'camera',
        lat: geo.coords.lat,
        lng: geo.coords.lng,
        accuracy: geo.coords.accuracy,
        faceCount: 1,
      });
      onSuccess(data);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      const details = err?.response?.data?.error?.details;
      if (code === 'OUTSIDE_OFFICE' && details?.distanceMeters !== undefined) {
        setServerError(`You are ${details.distanceMeters} m from the office; check-in is allowed within ${details.radiusMeters} m.`);
      } else {
        setServerError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const faceDetail =
    modelState === 'error'
      ? 'Face detection could not load.'
      : faceCount === null
        ? 'Looking for your face...'
        : faceCount === 0
          ? 'No face detected. Face the camera in good light.'
          : faceCount > 1
            ? `${faceCount} faces detected. Exactly one face needed.`
            : 'One face detected.';

  const geoDetail =
    geo.state === 'locating'
      ? 'Getting your location...'
      : geo.state === 'error'
        ? geo.error
        : `Accuracy about ${Math.round(accuracy)} m${accuracyOk ? '' : ` (needs ${MAX_ACCURACY_M} m or better)`}`;

  return (
    <Modal
      open
      onClose={submitting ? undefined : onClose}
      title="Check in with camera"
      description="We check that one face is visible and that you are at the office. No photo is saved."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
            <ScanFace className="size-4" /> Check in
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4 / 3' }}>
          <video ref={videoRef} className="size-full -scale-x-100 object-cover" playsInline muted autoPlay aria-label="Camera preview" />
          {cameraState === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
              <Spinner className="text-white" /> Opening camera...
            </div>
          )}
          {cameraState === 'ready' && faceCount !== null && (
            <span
              className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium ${
                oneFace ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
              }`}
            >
              {faceCount === 1 ? '1 face' : `${faceCount} faces`}
            </span>
          )}
        </div>

        {cameraState === 'error' && (
          <Alert type="error">
            {cameraError} You can use the normal Check in button instead, or ask HR for an attendance correction.
          </Alert>
        )}
        {!officeLocationSet && (
          <Alert type="info">The office location has not been set by Admin yet, so camera check-in is not available. Use the normal Check in button.</Alert>
        )}

        <ul className="space-y-2.5">
          <StepRow ok={oneFace} pending={cameraState === 'ready' && modelState === 'loading'} label="Exactly one face" detail={faceDetail} />
          <StepRow ok={geo.state === 'ready' && accuracyOk} pending={geo.state === 'locating'} label="Your location" detail={geoDetail} />
        </ul>
        {geo.state === 'error' && (
          <Button variant="secondary" className="px-3 py-1.5" onClick={locate}>
            <MapPin className="size-4" /> Try location again
          </Button>
        )}

        <Alert type="error">{serverError}</Alert>
      </div>
    </Modal>
  );
}
