import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Durable long-horizon telemetry indexes (#2099 approval, #2100 macro).
 *
 * Both series are append-only per world with one document per series
 * coordinate, so the unique compound doubles as the series read path
 * (prefix queries by world, then country/region) and as the cron-retry
 * guard: a retried turn upserts onto the same coordinate instead of
 * duplicating it.
 */
export async function seedTelemetryIndexes(db: Db, log: (msg: string) => void) {
  log("Telemetry indexes:");

  // One approval point per (world, country, region, turn); region is null
  // for national aggregates, which is a distinct coordinate, not a gap.
  await ensureIndex(
    db,
    "approvalTelemetry",
    { worldId: 1, country: 1, region: 1, turn: 1 },
    { name: "approvalTelemetry_world_country_region_turn_unique", unique: true },
    log
  );

  // One macro point per (world, country, region, metric, turn).
  await ensureIndex(
    db,
    "macroTelemetry",
    { worldId: 1, country: 1, region: 1, metric: 1, turn: 1 },
    { name: "macroTelemetry_world_country_region_metric_turn_unique", unique: true },
    log
  );

  log("Telemetry indexes ensured");
}
