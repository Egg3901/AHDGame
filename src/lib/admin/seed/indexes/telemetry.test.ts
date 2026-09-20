import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { seedTelemetryIndexes } from "./telemetry";

describe("seedTelemetryIndexes", () => {
  it("creates the unique durable-series coordinates for both collections", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    await seedTelemetryIndexes(db, () => {});

    expect(createIndex).toHaveBeenCalledWith(
      { worldId: 1, country: 1, region: 1, turn: 1 },
      { name: "approvalTelemetry_world_country_region_turn_unique", unique: true }
    );
    expect(createIndex).toHaveBeenCalledWith(
      { worldId: 1, country: 1, region: 1, metric: 1, turn: 1 },
      { name: "macroTelemetry_world_country_region_metric_turn_unique", unique: true }
    );
    expect(createIndex).toHaveBeenCalledTimes(2);
  });
});
