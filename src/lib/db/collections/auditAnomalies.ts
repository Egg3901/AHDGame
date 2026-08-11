import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuditAnomalyScan } from "../types/auditAnomalies";

/**
 * Typed `auditAnomalies` collection. Pass `db` when already connected to
 * avoid an extra `getDb()` await (e.g. turn processing).
 *
 * Written exclusively by `runAuditAnomalyScan`
 * (src/lib/audit/anomalyScan.ts), gated by `isAuditLogEnabled`
 * (src/lib/audit/featureFlag.ts). See src/lib/db/types/auditAnomalies.ts
 * for the summary shape and src/lib/admin/seed/indexes/auditAnomalies.ts
 * for the index set.
 */
export async function getAuditAnomaliesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AuditAnomalyScan>("auditAnomalies");
}
