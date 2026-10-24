import { useRef, useState } from 'react';
import { ImageUp, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import Modal from '../Modal.jsx';
import { Alert, Button } from '../ui.jsx';
import FaceCamera, { frameToJpeg, loadFaceApi } from './FaceCamera.jsx';

/** Reads an image file, checks it has exactly one face and returns a resized JPEG. */
async function fileToFaceJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('The file is not an image.'));
      el.src = url;
    });
    const faceapi = await loadFaceApi();
    const faces = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
    if (faces.length !== 1) throw new Error(faces.length ? 'The photo has more than one face. Use a photo of only this person.' : 'No face was found in the photo.');
    return frameToJpeg(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Enrolls a face for Face ID check-in. HR/Admin pass `employeeId` (camera or
 * an uploaded photo); without it, the signed-in person enrolls their own face
 * once (camera only, with a blink check).
 */
export default function FaceEnrollModal({ employeeId, employeeName, replacing = false, onClose, onEnrolled }) {
  const self = !employeeId;
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      setPhoto(await fileToFaceJpeg(file));
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put(self ? '/employees/me/face' : `/employees/${employeeId}/face`, { photo });
      onEnrolled?.(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title={self ? 'Set up Face ID' : `${replacing ? 'Re-enroll' : 'Enroll'} face${employeeName ? ` for ${employeeName}` : ''}`}
      description={
        self
          ? 'Your face is used to check you in and out, so nobody else can mark attendance for you. You can do this only once; after that only HR can change it.'
          : 'This photo becomes the reference for Face ID check-in. Only one person in the frame, face clearly visible.'
      }
      footer={
        photo ? (
          <>
            <Button variant="secondary" onClick={() => setPhoto(null)} disabled={saving}>
              <RotateCcw className="size-4" /> Retake
            </Button>
            <Button onClick={save} loading={saving}>
              <ShieldCheck className="size-4" /> Save face
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {photo ? (
          <img src={photo} alt="Captured face" className="mx-auto aspect-[4/3] w-full rounded-xl object-cover" />
        ) : (
          <FaceCamera onCapture={setPhoto} requireBlink={self} captureLabel="Capture face" />
        )}
        {!self && !photo && (
          <>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pickFile} />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
              <ImageUp className="size-4" /> Employee not here? Upload a clear photo instead
            </button>
          </>
        )}
        <Alert type="error">{error}</Alert>
        <p className="text-xs text-slate-500">
          What is stored: this reference photo and the last few verified check-in photos, visible only to HR, Admin and the employee. They are used only to confirm identity at check-in.
        </p>
      </div>
    </Modal>
  );
}
