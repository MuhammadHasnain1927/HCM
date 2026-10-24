import mongoose from 'mongoose';

export const EMPLOYEE_STATUS = Object.freeze(['active', 'probation', 'exited']);
export const GENDERS = Object.freeze(['male', 'female', 'other']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const employeeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    gender: { type: String, enum: [...GENDERS, null], default: null },
    dateOfBirth: { type: String, match: ISO_DATE, default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation', default: null },
    // Calendar days in the company timezone.
    joinDate: { type: String, required: true, match: ISO_DATE },
    exitDate: { type: String, match: ISO_DATE, default: null },
    exitReason: { type: String, trim: true, maxlength: 300, default: '' },
    status: { type: String, enum: EMPLOYEE_STATUS, default: 'active' },
    // Salary structure (brief, Section 3, M6): gross = 1.5 x basic (HRA 40%, medical 10%).
    salary: {
      basic: { type: Number, min: 0, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Bonus: face descriptor for camera check-in matching (128 numbers, no photo is stored).
    faceDescriptor: { type: [Number], default: undefined, select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

employeeSchema.index({ code: 1 }, { unique: true });
employeeSchema.index({ email: 1 }, { unique: true });
employeeSchema.index({ department: 1, status: 1 });
employeeSchema.index({ name: 1 });

export const Employee = mongoose.model('Employee', employeeSchema);

/** Salary breakdown from the basic salary (brief rule). */
export function salaryBreakdown(basic) {
  const b = Number(basic) || 0;
  const hra = round2(b * 0.4);
  const medical = round2(b * 0.1);
  return { basic: round2(b), hra, medical, gross: round2(b + hra + medical) };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
