import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { purgeRetiredRuRegionDocs, RU_RETIRED_REGION_IDS } from "./seedRU";

describe("purgeRetiredRuRegionDocs", () => {
  it("deletes only the three retired USSR region IDs from every affected store", async () => {
    const db = createMockDb() as unknown as MockDb;
    const stores = ["macroMetrics", "politicalMetrics", "stateBaselines", "stateBudgets"];
    for (const store of stores) {
      db.collection(store);
      db.collectionMocks[store].deleteMany.mockResolvedValue({ deletedCount: 3 });
    }

    const deleted = await purgeRetiredRuRegionDocs(db as unknown as Db);

    const expected = { _id: { $in: ["UKR", "BEL", "BLT"] } };
    expect(RU_RETIRED_REGION_IDS).toEqual(["UKR", "BEL", "BLT"]);
    expect(db.collectionMocks.macroMetrics.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.politicalMetrics.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.stateBaselines.deleteMany).toHaveBeenCalledWith(expected);
    expect(db.collectionMocks.stateBudgets.deleteMany).toHaveBeenCalledWith(expected);
    expect(deleted).toBe(12);
  });

  it("never targets intentional national-scope metric documents", async () => {
    const db = createMockDb() as unknown as MockDb;
    db.collection("macroMetrics");
    db.collection("politicalMetrics");
    db.collection("stateBaselines");
    db.collection("stateBudgets");

    await purgeRetiredRuRegionDocs(db as unknown as Db);

    const filter = db.collectionMocks.macroMetrics.deleteMany.mock.calls[0][0] as {
      _id: { $in: string[] };
    };
    expect(filter._id.$in).not.toContain("federal");
    expect(filter._id.$in).not.toContain("su_national");
    expect(filter._id.$in).not.toContain("dd_national");
    expect(vi.mocked(db.collectionMocks.macroMetrics.deleteMany)).toHaveBeenCalledTimes(1);
  });
});
