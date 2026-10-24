import mongoose from 'mongoose';
import { CASE_INSENSITIVE } from './Department.js';

// Built-in leave types from the brief (Section 3, M5). They are created at
// first-run setup as editable company policy, not as sample data. Leave and
// payroll rules look them up by `code`, so the code never changes.
export const DEFAULT_LEAVE_TYPES = Object.freeze([
  { code: 'annual', name: 'Annual leave', yearlyQuota: 14, isPaid: true },
  { code: 'sick', name: 'Sick leave', yearlyQuota: 8, isPaid: true },
  { code: 'casual', name: 'Casual leave', yearlyQuota: 10, isPaid: true },
  { code: 'unpaid', name: 'Unpaid leave', yearlyQuota: null, isPaid: false },
]);

const leaveTypeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true,
      match: /^[a-z0-9_]{2,30}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Days per year; null = unlimited (unpaid leave).
    yearlyQuota: { type: Number, min: 0, max: 365, default: null },
    isPaid: { type: Boolean, default: true },
    // Built-in types cannot be archived because leave and payroll rules depend on them.
    isSystem: { type: Boolean, default: false, immutable: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

leaveTypeSchema.index({ code: 1 }, { unique: true });
leaveTypeSchema.index({ name: 1 }, { unique: true, collation: CASE_INSENSITIVE });

export const LeaveType = mongoose.model('LeaveType', leaveTypeSchema);
