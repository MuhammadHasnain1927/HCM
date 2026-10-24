import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Eye, RefreshCw, ScanFace } from 'lucide-react';
import { Alert, Button, Spinner } from '../ui.jsx';

const DETECT_EVERY_MS = 150;
const CAPTURE_WIDTH = 480;
// After this long without a detected blink, the person may capture by hand
// (the server-side AI still checks for photos of screens and printed photos).
const BLINK_FALLBACK_MS = 10000;

// face-api is large; load it with the tiny detector + tiny landmarks only once, on demand.
let faceApiPromise = null;
export function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api').then(async (faceapi) => {
      await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('/models'), faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models')]);
      return faceapi;
    });
    faceApiPromise.catch(() => {
      faceApiPromise = null;
    });
  }
  return faceApiPromise;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Eye aspect ratio from 6 eye landmarks: drops sharply when the eye closes. */
function eyeRatio(p) {
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

/** Draws the current video frame (not mirrored) to a JPEG data URL. */
export function frameToJpeg(source, width = CAPTURE_WIDTH) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, width / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Live camera with face detection. Shows how many faces are in view and, with
 * `requireBlink`, waits for a blink (simple liveness check from the brief's
 * extra bonus) before the photo can be taken. `autoCapture` takes the photo by
 * itself as soon as the checks pass.
 *
 * onCapture(dataUrl) receives a JPEG of the current frame.
 */
export default function FaceCamera({ onCapture, requireBlink = false, autoCapture = false, disabled = false, captureLabel = 'Take photo', extraReady = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const capturedRef = useRef(false);
  const eyesRef = useRef({ max: 0, closed: false });
  const [cameraState, setCameraState] = useState('starting'); // starting | ready | error
  const [cameraError, setCameraError] = useState('');
  const [modelState, setModelState] = useState('loading'); // loading | ready | error
  const [faceCount, setFaceCount] = useState(null);
  const [blinked, setBlinked] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Camera
  useEffect(() => {
    let cancelled = false;
    setCameraState('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraError('This browser cannot open the camera. Use a recent Chrome, Edge, Safari or Firefox over HTTPS.');
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
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow the camera in your browser settings and try again.'
            : err?.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'The camera could not be opened. Close other apps that use it and try again.',
        );
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [attempt]);

  // Models
  useEffect(() => {
    let cancelled = false;
    loadFaceApi()
      .then(() => !cancelled && setModelState('ready'))
      .catch(() => !cancelled && setModelState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Detection + blink loop
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
          const found = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks(true);
          if (stopped) return;
          setFaceCount(found.length);
          if (found.length === 1 && requireBlink) {
            const lm = found[0].landmarks;
            const ear = (eyeRatio(lm.getLeftEye()) + eyeRatio(lm.getRightEye())) / 2;
            const eyes = eyesRef.current;
            eyes.max = Math.max(eyes.max * 0.995, ear); // slowly forget, so head moves do not freeze the baseline
            if (eyes.max > 0 && ear < eyes.max * 0.72) eyes.closed = true;
            else if (eyes.closed && ear > eyes.max * 0.88) {
              eyes.closed = false;
              setBlinked(true);
            }
          }
        }
      } catch {
        /* a missed frame is fine */
      }
      if (!stopped) timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [cameraState, modelState, requireBlink]);

  // Manual fallback if blink detection does not fire.
  useEffect(() => {
    if (!requireBlink || cameraState !== 'ready' || modelState !== 'ready') return undefined;
    const t = setTimeout(() => setFallback(true), BLINK_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [requireBlink, cameraState, modelState]);

  const oneFace = faceCount === 1;
  const live = !requireBlink || blinked || fallback;
  const ready = cameraState === 'ready' && modelState === 'ready' && oneFace && live && extraReady && !disabled;

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    capturedRef.current = true;
    onCapture(frameToJpeg(video));
  };

  // Auto capture once everything is ready (only once per blink).
  useEffect(() => {
    if (autoCapture && ready && blinked && !capturedRef.current) capture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture, ready, blinked]);

  // Let the parent ask for another attempt after a failed check.
  useEffect(() => {
    if (!disabled) capturedRef.current = false;
    if (!disabled && autoCapture) setBlinked(false);
  }, [disabled, autoCapture]);

  const hint =
    modelState === 'error'
      ? 'Face detection could not load. Check your connection and reopen this window.'
      : cameraState !== 'ready' || faceCount === null
        ? 'Looking for your face...'
        : faceCount === 0
          ? 'No face found. Face the camera in good light.'
          : faceCount > 1
            ? `${faceCount} faces in view. Only one person may be in the frame.`
            : requireBlink && !blinked
              ? fallback
                ? 'Blink not detected. Hold still and take the photo.'
                : 'Now blink once slowly.'
              : 'Ready.';

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4 / 3' }}>
        <video ref={videoRef} className="size-full -scale-x-100 object-cover" playsInline muted autoPlay aria-label="Camera preview" />
        {/* Oval guide */}
        {cameraState === 'ready' && (
          <div
            className={`pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[44%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 transition ${
              ready ? 'border-emerald-400' : oneFace ? 'border-amber-300' : 'border-white/50'
            }`}
            aria-hidden
          />
        )}
        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Spinner className="text-white" /> Opening camera...
          </div>
        )}
        {cameraState === 'ready' && modelState === 'loading' && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              <Spinner className="size-3.5 text-white" /> Loading face detection...
            </span>
          </div>
        )}
        {cameraState === 'ready' && faceCount !== null && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${oneFace ? 'bg-emerald-600' : 'bg-amber-500'}`}>
              <ScanFace className="mr-1 inline size-3.5" aria-hidden />
              {faceCount === 1 ? '1 face' : `${faceCount} faces`}
            </span>
            {requireBlink && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${blinked ? 'bg-emerald-600' : 'bg-slate-700/80'}`}>
                <Eye className="mr-1 inline size-3.5" aria-hidden />
                {blinked ? 'Blink OK' : 'Blink'}
              </span>
            )}
          </div>
        )}
      </div>

      {cameraState === 'error' ? (
        <Alert type="error">
          {cameraError}{' '}
          <button type="button" className="font-medium underline" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`flex items-center gap-1.5 text-sm ${ready ? 'text-emerald-700' : 'text-slate-600'}`}>
            {ready ? <CheckCircle2 className="size-4" aria-hidden /> : <RefreshCw className="size-4 animate-spin [animation-duration:3s]" aria-hidden />}
            {hint}
          </p>
          {!autoCapture || fallback ? (
            <Button onClick={capture} disabled={!ready}>
              <Camera className="size-4" /> {captureLabel}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
