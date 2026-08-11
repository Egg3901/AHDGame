import { getDb } from "@/lib/mongodb";
import type { AdminLogCategory, AdminLogAction } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";

interface CreateAdminLogParams {
  category: AdminLogCategory;
  action: AdminLogAction;
  username: string;
  characterName?: string;
  adminUsername?: string;
  details?: string;
}

/**
 * Creates an admin log entry in the database.
 *
 * Also mirrors a normalized envelope into the unified action-audit spine
 * (`actionAuditLog`, forensics/alt-detection plan §3.1/§4 T2.2) — this is
 * one of the few "choke points" that covers every privileged admin action
 * in one place rather than instrumenting each of the ~59 call sites. Never
 * throws into the caller; `recordAudit` itself is flag-gated and
 * fire-and-forget.
 */
export async function createAdminLog(params: CreateAdminLogParams): Promise<void> {
  try {
    const db = await getDb();
    const result = await db.collection("adminLogs").insertOne({
      ...params,
      createdAt: new Date(),
    });

    recordAudit({
      source: "admin",
      category: "admin",
      action: `admin.${params.action}`,
      // `username`/`adminUsername` are already validated identity strings
      // (never raw PII beyond what's stored elsewhere in `adminLogs`) — the
      // target of the privileged action. Prefer the character when one was
      // acted on (appointments/removals), otherwise the account itself.
      subject: params.characterName
        ? { type: "character", name: params.characterName }
        : { type: "user", name: params.username },
      // `adminUsername` is the moderator/admin who performed the action —
      // when present, attribute the row to them explicitly rather than
      // relying on ambient request context (some admin routes act on behalf
      // of another actor, e.g. system-initiated config changes).
      ...(params.adminUsername
        ? { actor: { kind: "admin" as const, name: params.adminUsername } }
        : {}),
      refs: { adminLogId: result.insertedId },
      outcome: "ok",
      ...(params.details ? { meta: { details: params.details } } : {}),
    });
  } catch (error) {
    // Log but don't throw - we don't want logging failures to break main functionality
    console.error("Failed to create admin log:", error);
  }
}
