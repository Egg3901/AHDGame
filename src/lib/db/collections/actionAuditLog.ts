import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ActionAuditRecord } from "../types/actionAuditLog";

/**
 * Typed `actionAuditLog` collection. Pass `db` when already connected to
 * avoid an extra `getDb()` await (e.g. turn processing).
 *
 * Written exclusively via `recordAudit`/`recordAuditBulk`
 * (src/lib/audit/recordAudit.ts), gated by `isAuditLogEnabled`
 * (src/lib/audit/featureFlag.ts). See src/lib/db/types/actionAuditLog.ts
 * for the envelope shape and src/lib/admin/seed/indexes/actionAuditLog.ts
 * for the index set.
 */
export async function getActionAuditLogCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<ActionAuditRecord>("actionAuditLog");
}
