import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { debitSharesFromNpp } from "./shareholderOps";

describe("debitSharesFromNpp", () => {
  it("checks the selected corporation state in the atomic share debit", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOneAndUpdate }) } as unknown as Db;
    const corporationId = new ObjectId();
    const nppId = new ObjectId();

    const remaining = await debitSharesFromNpp(db, corporationId, nppId, 10, undefined, {
      requireSufficient: true,
      guardFilter: { sharePrice: 42, publicFloat: 500 },
    });

    expect(remaining).toBe(-1);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: corporationId,
        sharePrice: 42,
        publicFloat: 500,
        shareholders: { $elemMatch: { nppId, shares: { $gte: 10 } } },
      },
      expect.anything(),
      { returnDocument: "after" }
    );
  });
});
