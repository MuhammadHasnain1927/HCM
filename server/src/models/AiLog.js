import mongoose from 'mongoose';

// Every AI call is logged (brief, Section 4 guardrails). Only a short excerpt
// of the question is kept; answers are not stored.
const aiLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true },
    kind: { type: String, enum: ['chat', 'summary', 'smart_leave'], required: true },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    tools: { type: [String], default: [] },
    fallbackUsed: { type: Boolean, default: false },
    ok: { type: Boolean, required: true },
    errorCode: { type: String, default: null },
    latencyMs: { type: Number, required: true },
    question: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_logs' },
);
aiLogSchema.index({ createdAt: -1 });
aiLogSchema.index({ user: 1, createdAt: -1 });

export const AiLog = mongoose.model('AiLog', aiLogSchema);
