import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for `auditAnomalies` — the scan-summary rollup written by
 * `src/lib/audit/anomalyScan.ts` (forensics/alt-detection rework plan §3.1
 * "Anomaly scanners", Phase 3 T3.1). Mirrors `apiAbuseScans`
 * (`src/lib/admin/seed/indexes/apiAccess.ts`): one recency-sorted TTL index
 * bounds collection growth, no other query pattern needed yet (the
 * per-row detail lives on the flagged `actionAuditLog` rows, which already
 * have their own `flags` index).
 */
export async function seedAuditAnomaliesIndexes(db: Db, log: (msg: string) => void) {
  log("Audit anomaly scan indexes:");

  // 30-day TTL keeps persisted anomaly scans bounded, same window as
  // apiAbuseScans.
  await ensureIndex(
    db,
    "auditAnomalies",
    { detectedAt: 1 },
    {
      name: "auditAnomalies_detectedAt_ttl",
      expireAfterSeconds: 30 * 24 * 60 * 60,
      background: true,
    },
    log
  );

  log("Audit anomaly scan indexes ensured");
}
