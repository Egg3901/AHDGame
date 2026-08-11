import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { insertFundSnapshot, FUND_SNAPSHOT_COLLECTION } from "./fundQueries";
import { createMockDb } from "@/lib/test-utils/mockDb";

describe("insertFundSnapshot", () => {
  it("upserts on fundId + turn for idempotent writes", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const snapshot = {
      fundId,
      turn: 42,
      quotedNav: 101,
      unitSupply: 1000,
      cashAnchor: 5000,
      totalHoldingsValueAnchor: 96000,
      backingRatio: 1,
      targetConstituents: [],
      createdAt: new Date(),
    };

    await insertFundSnapshot(db as never, snapshot);

    const coll = db.collectionMocks[FUND_SNAPSHOT_COLLECTION]!;
    expect(coll.updateOne).toHaveBeenCalledWith(
      { fundId, turn: 42 },
      expect.objectContaining({ $set: expect.objectContaining({ quotedNav: 101 }) }),
      { upsert: true }
    );
  });
});
