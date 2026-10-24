import mongoose from 'mongoose';

// Audit log of important actions: who did what to which record, with
// before/after snapshots. Entries are insert-only (brief: Admin cannot delete
// or change audit log entries), so every update/delete path is blocked here.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    actorRole: { type: String, default: 'system' },
    action: { type: String, required: true }, // e.g. "setup.complete", "leave.approve"
    entity: { type: String, required: true }, // e.g. "Settings", "LeaveRequest"
    entityId: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });

const blocked = () => {
  throw new Error('Audit log entries cannot be changed or deleted');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  auditLogSchema.pre(op, blocked);
}
auditLogSchema.pre('save', function onlyInsert() {
  if (!this.isNew) blocked();
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
