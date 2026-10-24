import mongoose from 'mongoose';

// Case-insensitive uniqueness: "Sales" and "sales" count as the same name.
export const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    // Departments are archived, never deleted, so old records keep their history.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

departmentSchema.index({ name: 1 }, { unique: true, collation: CASE_INSENSITIVE });

export const Department = mongoose.model('Department', departmentSchema);
