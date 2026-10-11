import type { Database } from '../db/client';
import { auditLog } from '../db/schema';
import { newId } from './ids';

export interface AuditEntry {
  actorId: string | null;
  /** Dotted action name, e.g. `user.approve`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  payload?: unknown;
  federationApprovalBy?: string | null;
}

/** Statement for the audit log; add it to the same `db.batch` as the change it records. */
export function auditInsert(db: Database, entry: AuditEntry, now = Date.now()) {
  return db.insert(auditLog).values({
    id: newId(now),
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    payloadJson: entry.payload === undefined ? null : JSON.stringify(entry.payload),
    federationApprovalBy: entry.federationApprovalBy ?? null,
    createdAt: now,
  });
}
