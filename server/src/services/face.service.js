import { z } from 'zod';
import { FaceProfile } from '../models/FaceProfile.js';
import { Employee } from '../models/Employee.js';
import { AiLog } from '../models/AiLog.js';
import { AppError, forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { gte } from '../utils/query.js';
import { assertEmployeeAccess, isManager } from '../middleware/auth.js';
import { callVision, configuredVisionProviders, ProviderError } from './ai/providers.js';
import { recordAudit } from './audit.service.js';
import { notifyHr } from './notifications.service.js';

/**
 * Face ID for attendance. A reference photo is enrolled once (by HR/Admin at
 * registration, or by the employee on first check-in); every check-in and
 * check-out sends a live photo that an AI vision model compares with it.
 * An AI comparison copes with beards, glasses, lighting and ageing better than
 * a fixed descriptor threshold, and each verified photo is kept as a "recent"
 * reference so the profile follows the person over time.
 */

const MAX_PHOTO_BYTES = 350 * 1024;
const MIN_PHOTO_BYTES = 2 * 1024;
const RECENT_KEEP = 3;
const VERIFY_DEADLINE_MS = 25000;
const MIN_CONFIDENCE = 0.7;
const MAX_ATTEMPTS_PER_HOUR = 15;

const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/** Accepts a data URL from the browser camera and returns { contentType, data }. */
export function parsePhoto(dataUrl, field = 'photo') {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  const bad = (message) => unprocessable(message, 'INVALID_PHOTO', [{ field, message }]);
  if (!m) throw bad('Send a JPEG, PNG or WebP photo from the camera');
  const data = Buffer.from(m[2], 'base64');
  if (data.length < MIN_PHOTO_BYTES) throw bad('The photo is too small. Try again in better light.');
  if (data.length > MAX_PHOTO_BYTES) throw bad('The photo is too large');
  if (!MAGIC[m[1]](data)) throw bad('The file is not a valid image');
  return { contentType: m[1], data };
}

const toImage = (img, label) => ({ label, mimeType: img.contentType, base64: Buffer.from(img.data).toString('base64') });

// ---------- Enrollment ----------

export async function getFaceStatus(employeeId) {
  const profile = await FaceProfile.findOne({ employee: employeeId }).select('source createdAt updatedAt lastVerifiedAt verifiedCount failedCount').lean();
  if (!profile) return { enrolled: false };
  return {
    enrolled: true,
    source: profile.source,
    enrolledAt: profile.updatedAt ?? profile.createdAt,
    lastVerifiedAt: profile.lastVerifiedAt,
    verifiedCount: profile.verifiedCount,
    failedCount: profile.failedCount,
  };
}

/**
 * HR/Admin enroll (or replace) any employee's face. People can enroll their
 * own face once, when nothing is enrolled yet; after that only HR/Admin can
 * change it, so a colleague cannot swap in their own face.
 */
export async function enrollFace(actor, employeeId, photoDataUrl, { ip } = {}) {
  const emp = await Employee.findById(employeeId).select('name status user faceEnrolledAt');
  if (!emp) throw notFound('Employee not found');
  if (emp.status === 'exited') throw unprocessable('This employee has exited', 'EMPLOYEE_EXITED');
  const self = String(actor.employee ?? '') === String(emp._id);
  const existing = await FaceProfile.exists({ employee: emp._id });

  if (!isManager(actor) && !self) throw forbidden('You can only enroll your own face');
  if (self && existing) throw new AppError(403, 'FACE_ALREADY_ENROLLED', 'Your face is already enrolled. Ask HR to re-enroll it.');

  const photo = parsePhoto(photoDataUrl);
  const source = isManager(actor) && !self ? 'hr' : 'self';
  await FaceProfile.findOneAndUpdate(
    { employee: emp._id },
    {
      $set: { reference: { ...photo, at: new Date() }, recent: [], source, enrolledBy: actor._id, lastVerifiedAt: null, verifiedCount: 0, failedCount: 0 },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  emp.faceEnrolledAt = new Date();
  await emp.save();

  await recordAudit({
    actor,
    action: existing ? 'employee.face_reenroll' : 'employee.face_enroll',
    entity: 'Employee',
    entityId: emp._id,
    after: { faceEnrolledAt: emp.faceEnrolledAt, source },
    ip,
  });
  return getFaceStatus(emp._id);
}

export async function resetFace(actor, employeeId, { ip } = {}) {
  const emp = await Employee.findById(employeeId).select('faceEnrolledAt');
  if (!emp) throw notFound('Employee not found');
  await FaceProfile.deleteOne({ employee: emp._id });
  const before = { faceEnrolledAt: emp.faceEnrolledAt };
  emp.faceEnrolledAt = null;
  await emp.save();
  await recordAudit({ actor, action: 'employee.face_reset', entity: 'Employee', entityId: emp._id, before, after: { faceEnrolledAt: null }, ip });
  return { enrolled: false };
}

/** The enrolled reference photo (HR/Admin, or the person themselves). */
export async function getFacePhoto(user, employeeId) {
  assertEmployeeAccess(user, employeeId);
  const profile = await FaceProfile.findOne({ employee: employeeId }).select('reference').lean();
  if (!profile) throw notFound('No face is enrolled for this employee');
  return { contentType: profile.reference.contentType, data: Buffer.from(profile.reference.data.buffer ?? profile.reference.data) };
}

// ---------- Verification ----------

const PROMPT = `You verify employee attendance for an HR system. You get reference photos of one enrolled employee and a LIVE photo taken by the camera right now.
Decide whether the person in the LIVE photo is the same person as in the reference photos.

Compare stable facial structure: face shape, eye shape and spacing, eyebrows, nose, mouth, jawline, ears, skin features.
People change over time: allow for different age, beard or no beard, hairstyle, glasses, make-up, weight, expression, lighting, camera angle and image quality.
Similar-looking people of the same age, gender and ethnicity are NOT a match unless the facial structure agrees.
Also check the LIVE photo for spoofing: a photo of a phone/laptop screen or a printed photo (visible screen edges, bezels, moire pattern, glare, paper edges, flat look) is a spoof.
Do not try to name or identify who the person is.

Reply with JSON only:
{"same_person": boolean, "confidence": number between 0 and 1, "live_face_count": integer, "spoof_suspected": boolean, "reason": "one short sentence"}`;

const resultSchema = z.object({
  same_person: z.boolean(),
  confidence: z.coerce.number().min(0).max(1),
  live_face_count: z.coerce.number().int().min(0),
  spoof_suspected: z.boolean(),
  reason: z.string().max(400).default(''),
});

function parseResult(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  try {
    return resultSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    throw new ProviderError('Face check returned invalid JSON', { code: 'INVALID_JSON' });
  }
}

const unavailable = () =>
  new AppError(503, 'FACE_CHECK_UNAVAILABLE', 'Face verification is not available right now. Try again in a minute, or request an attendance correction from HR.');

async function compare(images) {
  const providers = configuredVisionProviders();
  if (!providers.length) throw unavailable();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_DEADLINE_MS);
  const errors = [];
  try {
    for (const provider of providers) {
      if (controller.signal.aborted) break;
      try {
        const reply = await callVision(provider, { prompt: PROMPT, images, signal: controller.signal });
        return { ...parseResult(reply.text), provider: reply.provider, model: reply.model, fallbackUsed: errors.length > 0 };
      } catch (err) {
        errors.push(`${provider}: ${err.code ?? err.message}`);
        if (!(err instanceof ProviderError) || err.retryable === false) throw err;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const err = unavailable();
  err.providerErrors = errors;
  throw err;
}

/**
 * Checks a live photo against the employee's enrolled face. Throws 422
 * FACE_MISMATCH when it is not the same person (HR is notified), and 422
 * FACE_NOT_ENROLLED when there is nothing to compare with.
 */
export async function verifyFace(user, employee, photoDataUrl, { purpose = 'check-in' } = {}) {
  const live = parsePhoto(photoDataUrl);
  const profile = await FaceProfile.findOne({ employee: employee._id });
  if (!profile) throw unprocessable('Your face is not enrolled yet. Enroll it first.', 'FACE_NOT_ENROLLED');

  const recentAttempts = await AiLog.countDocuments({ user: user._id, kind: 'face_verify', createdAt: gte(new Date(Date.now() - 3600000)) });
  if (recentAttempts >= MAX_ATTEMPTS_PER_HOUR) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many face checks in the last hour. Ask HR for an attendance correction.');
  }

  const latestRecent = profile.recent[profile.recent.length - 1];
  const images = [
    toImage(profile.reference, 'enrolled reference photo'),
    ...(latestRecent ? [toImage(latestRecent, 'reference: recent verified check-in')] : []),
    toImage(live, 'LIVE photo taken now'),
  ];

  const started = Date.now();
  let result;
  try {
    result = await compare(images);
  } catch (err) {
    await logAttempt(user, started, { ok: false, errorCode: err.code ?? 'ERROR' });
    throw err;
  }

  const verified = result.same_person && result.confidence >= MIN_CONFIDENCE && result.live_face_count === 1 && !result.spoof_suspected;
  await logAttempt(user, started, { ok: true, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, errorCode: verified ? null : 'FACE_MISMATCH' });

  if (!verified) {
    profile.failedCount += 1;
    await profile.save();
    const why =
      result.live_face_count === 0
        ? 'No face was found in the photo.'
        : result.live_face_count > 1
          ? 'More than one face is in the photo.'
          : result.spoof_suspected
            ? 'The photo looks like a picture of a screen or a printed photo.'
            : "The face does not match the enrolled employee's face.";
    if (result.live_face_count === 1 && !result.spoof_suspected) {
      await notifyHr({
        type: 'face_mismatch',
        title: 'Face check failed',
        body: `A ${purpose} for ${employee.name} was refused: the face did not match the enrolled face.`,
        link: `/employees/${employee._id}`,
      });
    }
    throw new AppError(422, 'FACE_MISMATCH', `${why} Try again facing the camera in good light, or ask HR for an attendance correction.`, {
      confidence: result.confidence,
      reason: result.reason,
    });
  }

  // Keep the newest verified photos so the reference follows the person over time.
  profile.recent = [...profile.recent, { ...live, at: new Date() }].slice(-RECENT_KEEP);
  profile.lastVerifiedAt = new Date();
  profile.verifiedCount += 1;
  await profile.save();
  return { verified: true, confidence: result.confidence, provider: result.provider };
}

async function logAttempt(user, started, fields) {
  try {
    await AiLog.create({ user: user._id, role: user.role, kind: 'face_verify', latencyMs: Date.now() - started, ...fields });
  } catch (err) {
    console.error('Failed to write ai_logs:', err.message);
  }
}
