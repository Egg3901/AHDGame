import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ModAuditLogEntry } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";

interface CreateModAuditLogParams {
  moderatorId: string;
  moderatorName: string;
  action: string;
  targetUserId?: string;
  targetUsername?: string;
  details?: string;
}

/**
 * Creates an audit log entry for moderator actions.
 * Failures are logged but do not throw — audit logging should never break the main operation.
 *
 * Also mirrors a normalized envelope into the unified action-audit spine
 * (`actionAuditLog`, forensics/alt-detection plan §3.1/§4 T2.2) — one choke
 * point that covers every moderator action. Never throws into the caller;
 * `recordAudit` itself is flag-gated and fire-and-forget.
 */
export async function createModAuditLog(params: CreateModAuditLogParams): Promise<void> {
  const _id = new ObjectId();
  try {
    const db = await getDb();
    await db.collection<ModAuditLogEntry>("modAuditLog").insertOne({
      _id,
      moderatorId: new ObjectId(params.moderatorId),
      moderatorName: params.moderatorName,
      action: params.action,
      targetUserId: params.targetUserId ? new ObjectId(params.targetUserId) : undefined,
      targetUsername: params.targetUsername,
      details: params.details,
      createdAt: new Date(),
    });

    recordAudit({
      source: "admin",
      category: "admin",
      action: `mod.${params.action}`,
      // Attribute explicitly to the moderator who performed the action —
      // the caller already resolved and validated this identity, so prefer
      // it over ambient request context.
      actor: {
        kind: "admin",
        userId: new ObjectId(params.moderatorId),
        name: params.moderatorName,
      },
      subject: params.targetUserId
        ? { type: "user", id: new ObjectId(params.targetUserId), name: params.targetUsername }
        : { type: "user", name: params.targetUsername ?? "unknown" },
      refs: { modAuditLogId: _id },
      outcome: "ok",
      ...(params.details ? { meta: { details: params.details } } : {}),
    });
  } catch (error) {
    console.error("Failed to create mod audit log:", error);
  }
}
