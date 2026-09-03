import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  corpCapitalToAnchor: vi.fn((amount: number, _c: string, rate: number) => amount / rate),
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1, GBP: 2 }),
}));
vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return { ...actual, loadBondQuote: vi.fn() };
});
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  insertFundTransaction: vi.fn().mockResolvedValue(new ObjectId()),
}));

import { loadBondQuote } from "@/lib/bonds/marketPool";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { sellFundBondHoldingsForCash } from "./sellFundBondUnits";

let db: MockDb;
const fundId = new ObjectId();
const fund = { _id: fundId, name: "Bond Fund", quotedNav: 100, anchorCurrencyCode: "USD" as const };

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("bonds");
  db.collection("bondMarketPools");
  db.collection("indexFunds");
});

describe("sellFundBondHoldingsForCash", () => {
  it("sells enough units at the bid to cover the need, converts to anchor, and releases units to the pool", async () => {
    const bond = {
      _id: new ObjectId(),
      currencyCode: "GBP",
      issuerName: "UK Treasury",
      marketPrice: 1,
      holders: [{ fundId, units: 100 }],
    };
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [bond] });
    // Need 2,000 anchor = 4,000 GBP at rate 2; bid 990/unit -> 5 units (4,950 GBP = 2,475 anchor).
    vi.mocked(loadBondQuote).mockResolvedValue({
      bidPerUnit: 990,
      depthUnitsAtBid: 1_000,
    } as never);
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 1 });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000);

    expect(result.unitsSold).toBe(5);
    expect(result.proceedsAnchor).toBe(2_475);
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledWith(
      { _id: bond._id, holders: { $elemMatch: { fundId, units: { $gte: 5 } } } },
      expect.objectContaining({ $inc: { "holders.$.units": -5, publicFloat: 5 } })
    );
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      { _id: fundId },
      expect.objectContaining({ $inc: { cashAnchor: 2_475 } })
    );
    expect(insertFundTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "bond_sale", amountAnchor: 2_475 })
    );
  });

  it("sells nothing into a pool with no depth", async () => {
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          currencyCode: "USD",
          marketPrice: 1,
          holders: [{ fundId, units: 10 }],
        },
      ],
    });
    vi.mocked(loadBondQuote).mockResolvedValue({ bidPerUnit: 980, depthUnitsAtBid: 0 } as never);
    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 5_000);
    expect(result.unitsSold).toBe(0);
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });

  it("refunds the pool when the holder release loses a race", async () => {
    const bond = {
      _id: new ObjectId(),
      currencyCode: "USD",
      marketPrice: 1,
      holders: [{ fundId, units: 10 }],
    };
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [bond] });
    vi.mocked(loadBondQuote).mockResolvedValue({ bidPerUnit: 980, depthUnitsAtBid: 100 } as never);
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 1 });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 1_000);
    expect(result.unitsSold).toBe(0);
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      expect.objectContaining({ $inc: { cashLocal: 1_960, "lifetime.salesOut": -1_960 } })
    );
  });
});
