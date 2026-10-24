import mongoose from 'mongoose';
import { CASE_INSENSITIVE } from './Department.js';

const designationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// The same title may exist in different departments ("Manager" in Sales and in IT).
designationSchema.index({ department: 1, title: 1 }, { unique: true, collation: CASE_INSENSITIVE });

export const Designation = mongoose.model('Designation', designationSchema);
