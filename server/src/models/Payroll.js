import mongoose from 'mongoose';

const totalsSchema = new mongoose.Schema(
  {
    employees: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    earned: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
  },
  { _id: false },
);

// One run per month. HR prepares a draft; only Admin finalizes, which locks it (brief, M6).
const payrollRunSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ['draft', 'finalized'], default: 'draft' },
    workingDays: { type: Number, default: 0 },
    totals: { type: totalsSchema, default: () => ({}) },
    skipped: [{ employeeId: String, name: String, reason: String, _id: false }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    calculatedAt: { type: Date, default: Date.now },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
payrollRunSchema.index({ month: 1 }, { unique: true });

export const PayrollRun = mongoose.model('PayrollRun', payrollRunSchema);

// Payslips keep a snapshot of the employee and every number used, so a
// finalized month never changes when someone is later edited.
const payslipSchema = new mongoose.Schema(
  {
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
    month: { type: String, required: true },
    status: { type: String, enum: ['draft', 'finalized'], default: 'draft' },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeCode: String,
    employeeName: String,
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    departmentName: String,
    designationTitle: String,
    basic: Number,
    hra: Number,
    medical: Number,
    gross: Number,
    workingDays: Number,
    employedDays: Number,
    perDay: Number,
    earned: Number,
    absentDays: Number,
    unpaidLeaveDays: Number,
    halfDays: Number,
    lateDays: Number,
    latePenaltyDays: { type: Number, default: 0 },
    deductionDays: Number,
    deductions: Number,
    yearlyTaxableIncome: Number,
    tax: Number,
    net: Number,
    prorated: Boolean,
  },
  { timestamps: true },
);
payslipSchema.index({ run: 1, employee: 1 }, { unique: true });
payslipSchema.index({ employee: 1, month: -1 });

export const Payslip = mongoose.model('Payslip', payslipSchema);
