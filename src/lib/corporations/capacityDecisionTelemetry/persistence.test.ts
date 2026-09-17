import { describe, expect, it, vi } from "vitest";
import {
  CAPACITY_DECISION_COLLECTION,
  CAPACITY_DECISION_RETENTION_TURNS,
  recordCapacityDecisionBulkBestEffort,
} from "./persistence";
import type { CapacityDecisionObservation } from "./rules";

function observation(overrides: Partial<CapacityDecisionObservation> = {}): CapacityDecisionObservation {
  return {
    actor: "npp",
    cohort: "npp-managed",
    stage: "order",
    outcome: "placed",
    marketSharePct: 40,
    competitorCount: 3,
    rawDominanceMultiplier: 1.2,
    dominanceDensityFactor: 0.8,
    dominanceMultiplier: 1.16,
    unitPriceAnchor: 10,
    cashHeadroomAnchor: 500,
    requestedUnits: 7,
    ...overrides,
  };
}

function mockDb() {
  const bulkWrite = vi.fn().mockResolvedValue(undefined);
  const deleteMany = vi.fn().mockResolvedValue(undefined);
  const db = {
    collection: vi.fn().mockReturnValue({ bulkWrite, deleteMany }),
  };
  return { db: db as never, bulkWrite, deleteMany };
}

describe("recordCapacityDecisionBulkBestEffort", () => {
  it("flushes a whole cohort in one bulk write with schema version 2", async () => {
    const { db, bulkWrite, deleteMany } = mockDb();
    await recordCapacityDecisionBulkBestEffort(db, 100, [
      observation(),
      observation({ outcome: "mothballed", requestedUnits: 0 }),
    ]);

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: unknown; update: Record<string, unknown>; upsert: boolean };
    }>;
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(op.updateOne.filter).toEqual({ _id: "turn:100" });
      expect(op.updateOne.upsert).toBe(true);
      const set = op.updateOne.update.$set as Record<string, unknown>;
      expect(set.schemaVersion).toBe(2);
      expect(set.turn).toBe(100);
    }
    const placed = ops.find((op) =>
      Object.keys(op.updateOne.update.$inc as object).some((k) =>
        k.includes("npp:npp-managed:order:placed")
      )
    )!;
    expect(placed.updateOne.update.$inc).toMatchObject({
      "buckets.npp:npp-managed:order:placed.observations": 1,
      "buckets.npp:npp-managed:order:placed.requestedUnitsSum": 7,
    });
    // One collection, bounded retention, no per-row writes.
    expect(db.collection).toHaveBeenCalledTimes(1);
    expect(db.collection).toHaveBeenCalledWith(CAPACITY_DECISION_COLLECTION);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      turn: { $lt: 100 - CAPACITY_DECISION_RETENTION_TURNS + 1 },
    });
  });

  it("writes nothing when there is nothing to flush", async () => {
    const { db, bulkWrite, deleteMany } = mockDb();
    await recordCapacityDecisionBulkBestEffort(db, 100, []);
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("never throws: telemetry must not fail the turn", async () => {
    const { bulkWrite } = mockDb();
    bulkWrite.mockRejectedValueOnce(new Error("mongo down"));
    const { db } = mockDb();
    (db.collection as ReturnType<typeof vi.fn>).mockReturnValue({
      bulkWrite,
      deleteMany: vi.fn().mockRejectedValue(new Error("mongo down")),
    });
    await expect(
      recordCapacityDecisionBulkBestEffort(db, 100, [observation()])
    ).resolves.toBeUndefined();
  });
});
