import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AltLink, AltCluster, AltScoringRunRecord } from "../types/altDetection";

/**
 * Typed `altLinks` / `altClusters` collections. Pass `db` when already
 * connected to avoid an extra `getDb()` await (e.g. turn processing).
 *
 * Upserted by `src/lib/altDetection/run.ts`, gated by
 * `isAltScoringEnabled` (src/lib/altDetection/featureFlag.ts). See
 * src/lib/db/types/altDetection.ts for the confidence-model shapes and
 * src/lib/admin/seed/indexes/altDetection.ts for the index set.
 */
export async function getAltLinksCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AltLink>("altLinks");
}

export async function getAltClustersCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AltCluster>("altClusters");
}

/**
 * `altScoringRuns` — per-run telemetry written by
 * `src/lib/altDetection/runMetrics.ts`, TTL-expired after 90 days. Read by
 * `GET /api/admin/alts/metrics` to make the detector's own behavior
 * (candidate volume, confidence drift, signals going silent) observable.
 */
export async function getAltScoringRunsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<AltScoringRunRecord>("altScoringRuns");
}
