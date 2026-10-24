import mongoose from 'mongoose';

// Public holidays are skipped when counting leave days and payroll working days.
// The date is stored as a plain "YYYY-MM-DD" calendar day in the company
// timezone, so it never shifts when the server runs in UTC.
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true },
);

holidaySchema.index({ date: 1 }, { unique: true });

export const Holiday = mongoose.model('Holiday', holidaySchema);
