import { AuditLog } from '../models/AuditLog.js';

// Fields that must never be copied into audit snapshots.
const SECRET_FIELDS = ['passwordHash', 'tokenVersion', '__v'];

function snapshot(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const field of SECRET_FIELDS) delete plain[field];
  return plain;
}

/**
 * Record an important action. `actor` is the signed-in user document
 * (or null for system actions such as the env-based bootstrap).
 */
export async function recordAudit({ actor, action, entity, entityId, before, after, ip }) {
  return AuditLog.create({
    actor: actor?._id ?? null,
    actorName: actor?.name ?? 'system',
    actorRole: actor?.role ?? 'system',
    action,
    entity,
    entityId: entityId ? String(entityId) : null,
    before: snapshot(before),
    after: snapshot(after),
    ip: ip ?? null,
  });
}
