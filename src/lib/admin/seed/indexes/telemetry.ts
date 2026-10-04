import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import { ensureIndex } from "./helpers";

export type TelemetryIndexPlan = {
  collection: "approvalTelemetry" | "macroTelemetry";
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string; unique: true };
};

/**
 * Durable long-horizon telemetry indexes (#2099 approval, #2100 macro).
 *
 * Both series are append-only per world with one document per series
 * coordinate, so the unique compound doubles as the series read path
 * (prefix queries by world, then country/region) and as the cron-retry
 * guard: a retried turn upserts onto the same coordinate instead of
 * duplicating it. It is also the only index the per-turn upserts can use:
 * without it every upsert scans the whole collection (#2688).
 *
 * Shared with the live-world migration so the two definitions cannot drift.
 */
export const TELEMETRY_INDEXES: readonly TelemetryIndexPlan[] = [
  // One approval point per (world, country, region, turn); region is null
  // for national aggregates, which is a distinct coordinate, not a gap.
  {
    collection: "approvalTelemetry",
    keys: { worldId: 1, country: 1, region: 1, turn: 1 },
    options: { name: "approvalTelemetry_world_country_region_turn_unique", unique: true },
  },
  // One macro point per (world, country, region, metric, turn).
  {
    collection: "macroTelemetry",
    keys: { worldId: 1, country: 1, region: 1, metric: 1, turn: 1 },
    options: { name: "macroTelemetry_world_country_region_metric_turn_unique", unique: true },
  },
  // One research country-turn row per (world, country, turn) (#2331, #2336).
  {
    collection: "countryTurnTelemetry",
    keys: { worldId: 1, country: 1, turn: 1 },
    options: { name: "countryTurnTelemetry_world_country_turn_unique", unique: true },
  },
  // One research securities row per (world, turn) (#2332).
  {
    collection: "securityTelemetry",
    keys: { worldId: 1, turn: 1 },
    options: { name: "securityTelemetry_world_turn_unique", unique: true },
  },
];

export async function seedTelemetryIndexes(db: Db, log: (msg: string) => void) {
  log("Telemetry indexes:");
  for (const plan of TELEMETRY_INDEXES) {
    await ensureIndex(db, plan.collection, plan.keys, plan.options, log);
  }
  log("Telemetry indexes ensured");
}
