import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-09-30-long-horizon-telemetry-indexes";

function mockDb(createIndex = vi.fn(async () => "ok")) {
  const collection = vi.fn((_name: string) => ({ createIndex }));
  return { db: { collection } as unknown as Db, createIndex, collection };
}

describe("2026-09-30-long-horizon-telemetry-indexes migration", () => {
  it("creates both unique series-coordinate indexes with the seed definitions", async () => {
    const { db, createIndex, collection } = mockDb();
    const result = await migration.execute(db, { dryRun: false });

    expect(collection.mock.calls.map((call) => call[0])).toEqual([
      "approvalTelemetry",
      "macroTelemetry",
    ]);
    expect(createIndex).toHaveBeenCalledWith(
      { worldId: 1, country: 1, region: 1, turn: 1 },
      { name: "approvalTelemetry_world_country_region_turn_unique", unique: true }
    );
    expect(createIndex).toHaveBeenCalledWith(
      { worldId: 1, country: 1, region: 1, metric: 1, turn: 1 },
      { name: "macroTelemetry_world_country_region_metric_turn_unique", unique: true }
    );
    expect(result.documentsUpdated).toBe(2);
  });

  it("reports a duplicate-key build instead of failing startup", async () => {
    const duplicate = Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    const createIndex = vi.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce("ok");
    const { db } = mockDb(createIndex);

    const result = await migration.execute(db, { dryRun: false });

    expect(result.documentsUpdated).toBe(1);
    expect(result.notes?.[0]).toMatch(/^not created approvalTelemetry\./);
    expect(result.notes?.[1]).toMatch(/^created\/verified macroTelemetry\./);
  });

  it("rethrows unexpected errors", async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error("network down"));
    const { db } = mockDb(createIndex);

    await expect(migration.execute(db, { dryRun: false })).rejects.toThrow("network down");
  });

  it("writes nothing on a dry run", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(2);
  });

  it("is idempotent so it can run at startup", () => {
    expect(migration.idempotent).toBe(true);
  });
});
