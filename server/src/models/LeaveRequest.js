import mongoose from 'mongoose';

export const LEAVE_STATUS = Object.freeze(['pending', 'approved', 'rejected', 'cancelled']);

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // Working days only: weekends and public holidays are skipped (brief, M5).
    days: { type: Number, required: true, min: 1 },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: LEAVE_STATUS, default: 'pending' },
    source: { type: String, enum: ['form', 'smart'], default: 'form' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewComment: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

leaveRequestSchema.index({ employee: 1, startDate: 1 });
leaveRequestSchema.index({ status: 1, startDate: 1 });

export const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
