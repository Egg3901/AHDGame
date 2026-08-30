import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-30-purge-retired-ru-metric-regions";

function setup(count: number) {
  const db = createMockDb() as unknown as MockDb;
  const stores = ["macroMetrics", "politicalMetrics", "stateBaselines", "stateBudgets"];
  for (const store of stores) {
    db.collection(store);
    db.collectionMocks[store].countDocuments.mockResolvedValue(count);
    db.collectionMocks[store].deleteMany.mockResolvedValue({ deletedCount: count });
  }
  return db;
}

describe("2026-08-30-purge-retired-ru-metric-regions", () => {
  it("reports a dry run without deleting", async () => {
    const db = setup(3);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsScanned).toBe(12);
    expect(result.documentsDeleted).toBe(0);
    expect(db.collectionMocks.macroMetrics.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.politicalMetrics.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.stateBaselines.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.stateBudgets.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the exact retired IDs from all affected stores", async () => {
    const db = setup(3);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const expected = { _id: { $in: ["UKR", "BEL", "BLT"] } };
    expect(db.collectionMocks.macroMetrics.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.politicalMetrics.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.stateBaselines.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.stateBudgets.deleteMany).toHaveBeenCalledWith(expected);
    expect(result.documentsDeleted).toBe(12);
  });

  it("is an idempotent no-op after the ghosts are gone", async () => {
    const db = setup(0);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsScanned).toBe(0);
    expect(result.documentsDeleted).toBe(0);
    expect(db.collectionMocks.macroMetrics.deleteMany).not.toHaveBeenCalled();
  });
});
