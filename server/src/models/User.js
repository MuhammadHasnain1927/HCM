import mongoose from 'mongoose';

export const ROLES = Object.freeze({ ADMIN: 'admin', HR: 'hr', EMPLOYEE: 'employee' });

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    // Set for Employee (and optionally HR) accounts; links the login to an employee record.
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    isActive: { type: Boolean, default: true },
    // New accounts get a temporary password that must be changed on first sign-in.
    mustChangePassword: { type: Boolean, default: false },
    // Bumped on password change, reset or deactivation so old JWTs stop working.
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    // The Admin created by first-run setup. The partial unique index below allows only
    // one, so two setup requests racing each other cannot both create an Admin.
    isOwner: { type: Boolean, default: undefined },
  },
  { timestamps: true },
);

userSchema.index({ isOwner: 1 }, { unique: true, partialFilterExpression: { isOwner: true } });

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    employeeId: this.employee ? this.employee.toString() : null,
    isActive: this.isActive,
    mustChangePassword: this.mustChangePassword,
    lastLoginAt: this.lastLoginAt,
  };
};

export const User = mongoose.model('User', userSchema);
