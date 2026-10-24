import mongoose from 'mongoose';

// One record per employee per day (brief, Section 3, M4). Times are stamped by
// the server; `date` is the calendar day in the company timezone.
// Stored status is the outcome of the day: present / late / half_day.
// "missing_checkout", "absent" and "on_leave" are derived when reading.
export const STORED_STATUS = Object.freeze(['present', 'late', 'half_day']);

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, default: null },
    status: { type: String, enum: STORED_STATUS, required: true },
    lateMinutes: { type: Number, default: 0 },
    workedMinutes: { type: Number, default: null },
    source: { type: String, enum: ['web', 'camera', 'correction'], default: 'web' },
    // Camera check-ins keep the result of the location and face checks, never a photo.
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      distanceMeters: { type: Number, default: null },
    },
    faceVerified: { type: Boolean, default: null },
    faceConfidence: { type: Number, default: null },
  },
  { timestamps: true },
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);

const correctionSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkIn: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    checkOut: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: null },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewComment: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

correctionSchema.index({ status: 1, createdAt: -1 });
correctionSchema.index({ employee: 1, date: 1 });

export const AttendanceCorrection = mongoose.model('AttendanceCorrection', correctionSchema);
