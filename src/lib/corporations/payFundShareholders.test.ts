import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { payFundShareholderRows } from "./payFundShareholders";

function makeDb() {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const db = { collection: vi.fn().mockReturnValue({ updateOne }) } as unknown as Db;
  return { db, updateOne };
}

describe("payFundShareholderRows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("credits each fund's cashAnchor (₳, no FX) and drops its holding of the dissolved corp", async () => {
    const corpId = new ObjectId();
    const fundA = new ObjectId();
    const fundB = new ObjectId();
    const { db, updateOne } = makeDb();

    const total = await payFundShareholderRows(
      db,
      [
        { fundId: fundA.toString(), name: "Broad", shares: 100, payout: 5_000 },
        { fundId: fundB.toString(), name: "Tech", shares: 50, payout: 2_500 },
      ],
      corpId,
      new Date()
    );

    expect(total).toBe(7_500);
    expect(updateOne).toHaveBeenCalledTimes(2);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter._id.toString()).toBe(fundA.toString());
    expect(update.$inc.cashAnchor).toBe(5_000); // payout is already ₳ — no conversion
    expect(update.$pull.holdings.corporationId).toBe(corpId);
  });

  it("skips non-positive payouts and pays nothing for an empty list", async () => {
    const { db, updateOne } = makeDb();
    const total = await payFundShareholderRows(
      db,
      [{ fundId: new ObjectId().toString(), name: "Z", shares: 0, payout: 0 }],
      new ObjectId(),
      new Date()
    );
    expect(total).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
