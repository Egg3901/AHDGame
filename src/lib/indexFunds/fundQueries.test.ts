import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  FUND_COLLECTION,
  FUND_POSITION_COLLECTION,
  FUND_TRANSACTION_COLLECTION,
  FUND_REDEMPTION_QUEUE_COLLECTION,
  FUND_SNAPSHOT_COLLECTION,
  creditFundPosition,
} from "./fundQueries";

describe("fundQueries constants", () => {
  it("collection names match the migration index plan", () => {
    expect(FUND_COLLECTION).toBe("indexFunds");
    expect(FUND_POSITION_COLLECTION).toBe("indexFundPositions");
    expect(FUND_TRANSACTION_COLLECTION).toBe("indexFundTransactions");
    expect(FUND_REDEMPTION_QUEUE_COLLECTION).toBe("indexFundRedemptionQueue");
    expect(FUND_SNAPSHOT_COLLECTION).toBe("indexFundSnapshots");
  });
});

describe("creditFundPosition", () => {
  it("updates weighted average NAV when crediting an existing position", async () => {
    const fundId = new ObjectId();
    const characterId = new ObjectId();
    const updatedPosition = {
      _id: new ObjectId(),
      fundId,
      holderKind: "character",
      characterId,
      units: 15,
      avgNavAnchor: 11.33,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findOneAndUpdate = vi.fn().mockResolvedValue(updatedPosition);
    const insertOne = vi.fn();
    const db = {
      collection: vi.fn(() => ({ findOneAndUpdate, insertOne })),
    } as never;

    const result = await creditFundPosition(db, fundId, "character", { characterId }, 5, 12);

    expect(result).toBe(updatedPosition);
    expect(insertOne).not.toHaveBeenCalled();
    const updatePipeline = findOneAndUpdate.mock.calls[0][1] as unknown[];
    expect(updatePipeline).toEqual([
      expect.objectContaining({
        $set: expect.objectContaining({
          avgNavAnchor: expect.any(Object),
          units: { $add: ["$units", 5] },
        }),
      }),
    ]);
    expect(JSON.stringify(updatePipeline)).toContain("60");
  });
});
