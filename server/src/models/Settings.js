import mongoose from 'mongoose';

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Company-wide settings. There is exactly one document (key = 'company'),
// enforced by the unique index, which also makes first-run setup race-safe.
// Rule changes apply to new records only (brief, Section 3, M2).
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'company', unique: true, immutable: true },
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    // Office rules are evaluated in the company's timezone, not the server's
    // (hosting providers run in UTC).
    timezone: { type: String, default: 'Asia/Karachi' },
    officeStart: { type: String, default: '09:00', match: TIME_HHMM },
    officeEnd: { type: String, default: '18:00', match: TIME_HHMM },
    graceMinutes: { type: Number, default: 15, min: 0, max: 120 },
    halfDayHours: { type: Number, default: 5, min: 1, max: 12 },
    // JavaScript day numbers: 0 = Sunday ... 6 = Saturday. Default weekend Sat-Sun.
    weekendDays: { type: [Number], default: [6, 0] },
    office: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
      radiusMeters: { type: Number, min: 10, max: 5000, default: 150 },
    },
    currency: { type: String, default: 'PKR' },
    // Bonus rule: every 3 late days deduct half a day in payroll. Off by default.
    latePenaltyEnabled: { type: Boolean, default: false },
    // Check-in and check-out need a live photo that AI matches to the enrolled face.
    faceCheckInRequired: { type: Boolean, default: true },
    // Set once the owner Admin exists. Until then setup can be re-run (e.g. after a dropped connection).
    setupCompletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

settingsSchema.statics.get = function get() {
  return this.findOne({ key: 'company' });
};

export const Settings = mongoose.model('Settings', settingsSchema);
