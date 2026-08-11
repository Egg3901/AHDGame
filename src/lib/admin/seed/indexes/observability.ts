import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the admin observability layer — game health snapshots, code
 * quality snapshots, and first-party site-traffic pageviews.
 *
 * Absorbs:
 *   - scripts/migrations/deprecated/add-health-quality-indexes.ts
 *   - scripts/migrations/deprecated/add-site-traffic-indexes.ts
 */
export async function seedObservabilityIndexes(db: Db, log: (msg: string) => void) {
  log("Game health snapshot indexes:");

  // 30-day TTL so admin health history doesn't grow unbounded.
  await ensureIndex(
    db,
    "gameHealthSnapshots",
    { timestamp: 1 },
    { name: "ghs_timestamp_ttl", expireAfterSeconds: 30 * 24 * 60 * 60 },
    log
  );

  await ensureIndex(db, "gameHealthSnapshots", { turn: -1 }, { name: "ghs_turn_desc" }, log);

  await ensureIndex(
    db,
    "gameHealthSnapshots",
    { "turnProcessing.warningCount": 1, "turnProcessing.errorCount": 1, turn: -1 },
    { name: "ghs_warnings_errors_turn" },
    log
  );

  log("Code quality snapshot indexes:");

  await ensureIndex(
    db,
    "codeQualitySnapshots",
    { timestamp: -1 },
    { name: "cqs_timestamp_desc" },
    log
  );

  await ensureIndex(
    db,
    "codeQualitySnapshots",
    { environment: 1, timestamp: -1 },
    { name: "cqs_env_timestamp" },
    log
  );

  log("Site traffic indexes:");

  // ~180-day TTL so traffic history is bounded.
  await ensureIndex(
    db,
    "siteTrafficPageviews",
    { recordedAt: 1 },
    { name: "stpv_recordedAt_ttl", expireAfterSeconds: 15_552_000 },
    log
  );
  await ensureIndex(
    db,
    "siteTrafficPageviews",
    { recordedAt: -1, path: 1 },
    { name: "stpv_recordedAt_path" },
    log
  );

  log("Observability indexes ensured");
}
