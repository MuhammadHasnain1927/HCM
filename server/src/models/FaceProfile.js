import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// The enrolled face of one employee, used to verify check-ins. Kept apart from
// the employee record so photos are never loaded with directory queries.
// `recent` holds the last few verified check-in photos, so the reference
// follows slow changes in a person's face (beard, glasses, age).
const faceProfileSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    reference: { type: imageSchema, required: true },
    recent: { type: [imageSchema], default: [] },
    source: { type: String, enum: ['hr', 'self'], required: true },
    enrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastVerifiedAt: { type: Date, default: null },
    verifiedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const FaceProfile = mongoose.model('FaceProfile', faceProfileSchema);
