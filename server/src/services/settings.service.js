import { Settings } from '../models/Settings.js';
import { notFound, unprocessable } from '../utils/AppError.js';
import { recordAudit } from './audit.service.js';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function serializeSettings(s) {
  return {
    companyName: s.companyName,
    timezone: s.timezone,
    officeStart: s.officeStart,
    officeEnd: s.officeEnd,
    graceMinutes: s.graceMinutes,
    halfDayHours: s.halfDayHours,
    weekendDays: [...s.weekendDays].sort((a, b) => a - b),
    office: {
      lat: s.office?.lat ?? null,
      lng: s.office?.lng ?? null,
      radiusMeters: s.office?.radiusMeters ?? 150,
    },
    currency: s.currency,
    latePenaltyEnabled: Boolean(s.latePenaltyEnabled),
    faceCheckInRequired: s.faceCheckInRequired !== false,
    updatedAt: s.updatedAt,
  };
}

export async function getSettings() {
  const settings = await Settings.get();
  if (!settings) throw notFound('Company settings not found. Complete first-run setup.');
  return serializeSettings(settings);
}

/**
 * Partial update of company settings (Admin only). Changes apply to records
 * created from now on; existing attendance and leave keep the status they got.
 */
export async function updateSettings(actor, changes, { ip } = {}) {
  const settings = await Settings.get();
  if (!settings) throw notFound('Company settings not found. Complete first-run setup.');
  const before = serializeSettings(settings);

  const next = {
    ...before,
    ...changes,
    office: { ...before.office, ...(changes.office ?? {}) },
  };

  // Cross-field rules, checked on the merged result so partial updates stay consistent.
  if (toMinutes(next.officeEnd) <= toMinutes(next.officeStart)) {
    throw unprocessable('Office end time must be after the start time', 'INVALID_SETTINGS', [{ field: 'officeEnd', message: 'Must be after start time' }]);
  }
  const workdayHours = (toMinutes(next.officeEnd) - toMinutes(next.officeStart)) / 60;
  if (next.halfDayHours >= workdayHours) {
    throw unprocessable('Half-day threshold must be shorter than the working day', 'INVALID_SETTINGS', [
      { field: 'halfDayHours', message: `Must be less than ${workdayHours} hours` },
    ]);
  }
  if (next.weekendDays.length >= 7) {
    throw unprocessable('At least one working day is required', 'INVALID_SETTINGS', [{ field: 'weekendDays', message: 'Leave at least one working day' }]);
  }
  if ((next.office.lat === null) !== (next.office.lng === null)) {
    throw unprocessable('Set both latitude and longitude, or neither', 'INVALID_SETTINGS', [{ field: 'office', message: 'Latitude and longitude go together' }]);
  }

  settings.set({
    companyName: next.companyName,
    timezone: next.timezone,
    officeStart: next.officeStart,
    officeEnd: next.officeEnd,
    graceMinutes: next.graceMinutes,
    halfDayHours: next.halfDayHours,
    weekendDays: [...new Set(next.weekendDays)],
    office: next.office,
    latePenaltyEnabled: next.latePenaltyEnabled,
    faceCheckInRequired: next.faceCheckInRequired,
  });
  await settings.save();

  const after = serializeSettings(settings);
  await recordAudit({ actor, action: 'settings.update', entity: 'Settings', entityId: settings._id, before, after, ip });
  return after;
}
