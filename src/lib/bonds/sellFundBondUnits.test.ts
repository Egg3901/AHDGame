import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  BOND_FUND_SELL_CREDIT,
  BOND_FUND_SELL_TX,
  sellFundBondHoldingsForCash,
} from "./sellFundBondUnits";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  corpCapitalToAnchor: vi.fn((amount: number, _c: string, rate: number) => amount / rate),
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1, GBP: 2 }),
}));
vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return { ...actual, loadBondQuote: vi.fn() };
});

import { loadBondQuote } from "@/lib/bonds/marketPool";

let db: MockDb;
const fundId = new ObjectId();
const bondId = new ObjectId();
const fund = { _id: fundId, name: "Bond Fund", quotedNav: 100, anchorCurrencyCode: "USD" as const };
const bond = {
  _id: bondId,
  currencyCode: "GBP",
  issuerName: "UK Treasury",
  marketPrice: 1,
  holders: [{ fundId, units: 100 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("bonds");
  db.collection("bondMarketPools");
  db.collection("indexFunds");
  db.collection("indexFundTransactions");
  db.collection("nonAtomicMoneyFlowReceipts");
  db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [bond] });
  // Need 2,000 anchor = 4,000 GBP at rate 2; bid 990/unit -> 5 units (4,950 GBP = 2,475 anchor).
  vi.mocked(loadBondQuote).mockResolvedValue({
    bidPerUnit: 990,
    depthUnitsAtBid: 1_000,
  } as never);
});

function receipts() {
  return db.collectionMocks.nonAtomicMoneyFlowReceipts;
}

function subFingerprint() {
  return `bond-fund-sell:${fundId.toHexString()}:${bondId.toHexString()}:5:4950:2475`;
}

describe("sellFundBondHoldingsForCash", () => {
  it("sells enough units at the bid to cover the need, converts to anchor, and releases units to the pool", async () => {
    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000);

    expect(result).toEqual({ proceedsAnchor: 2_475, unitsSold: 5, bondsTouched: 1 });
    // Gated keyed pool debit (same cashLocal guard as the legacy gated debit).
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "GBP", cashLocal: { $gte: 4950 } }),
      expect.objectContaining({
        $inc: expect.objectContaining({ cashLocal: -4950, "lifetime.salesOut": 4950 }),
      }),
      undefined
    );
    // Guarded holder release back to the float.
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: bondId,
        holders: { $elemMatch: { fundId, units: { $gte: 5 } } },
      }),
      expect.objectContaining({ $inc: { "holders.$.units": -5, publicFloat: 5 } }),
      undefined
    );
    // Fund credited in anchor terms with the flow key.
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: fundId, appliedMoneyFlowKeys: expect.anything() }),
      expect.objectContaining({ $inc: expect.objectContaining({ cashAnchor: 2_475 }) }),
      undefined
    );
    // Deterministic transaction row, same _id on retry.
    const txCall = db.collectionMocks.indexFundTransactions.insertOne.mock.calls[0]?.[0] as {
      _id: unknown;
      kind: string;
      amountAnchor: number;
    };
    expect(txCall.kind).toBe("bond_sale");
    expect(txCall.amountAnchor).toBe(2_475);
    expect(txCall._id).toBeDefined();
  });

  it("sells nothing into a pool with no depth", async () => {
    vi.mocked(loadBondQuote).mockResolvedValue({ bidPerUnit: 980, depthUnitsAtBid: 0 } as never);

    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 5_000);

    expect(result).toEqual({ proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 });
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bondMarketPools.updateOne).not.toHaveBeenCalled();
  });

  it("sells nothing when no cash is needed", async () => {
    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 0);

    expect(result).toEqual({ proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 });
    expect(db.collectionMocks.bonds.find).not.toHaveBeenCalled();
  });

  it("skips the bond when the gated pool debit refuses, without touching the fund", async () => {
    db.collectionMocks.bondMarketPools.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue(null);

    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000);

    expect(result).toEqual({ proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 });
    // Release-first order: the release is compensated back to the holder.
    const releaseCalls = db.collectionMocks.bonds.updateOne.mock.calls;
    expect(releaseCalls.length).toBe(2);
    expect(releaseCalls[1]?.[1]).toEqual(
      expect.objectContaining({ $inc: { "holders.$.units": 5, publicFloat: -5 } })
    );
    expect(db.collectionMocks.indexFunds.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFundTransactions.insertOne).not.toHaveBeenCalled();
  });

  it("skips the bond when the holder release loses the race, without debiting the pool", async () => {
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    db.collectionMocks.bonds.findOne.mockResolvedValue({ _id: bondId, holders: [] });

    const result = await sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000);

    expect(result).toEqual({ proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 });
    // Release-first order means the pool was never debited for a lost race:
    // stronger than the legacy debit-then-refund, same skip outcome.
    expect(db.collectionMocks.bondMarketPools.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFunds.updateOne).not.toHaveBeenCalled();
  });

  it("compensates release and pool when the fund credit finds no fund row", async () => {
    db.collectionMocks.indexFunds.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.indexFunds.findOne.mockResolvedValue(null);

    await expect(sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000)).rejects.toThrow(
      BOND_FUND_SELL_CREDIT
    );

    // Both applied steps reversed: pool refunded, units back on the holder.
    const poolCalls = db.collectionMocks.bondMarketPools.updateOne.mock.calls;
    expect(poolCalls.length).toBe(2);
    expect(poolCalls[1]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashLocal: 4950 }) })
    );
    const releaseCalls = db.collectionMocks.bonds.updateOne.mock.calls;
    expect(releaseCalls.length).toBe(2);
    expect(releaseCalls[1]?.[1]).toEqual(
      expect.objectContaining({ $inc: { "holders.$.units": 5, publicFloat: -5 } })
    );
    expect(db.collectionMocks.indexFundTransactions.insertOne).not.toHaveBeenCalled();
  });

  it("compensates the full prefix when the transaction insert fails", async () => {
    db.collectionMocks.indexFundTransactions.insertOne.mockRejectedValueOnce(
      new Error("transient insert failure")
    );

    await expect(sellFundBondHoldingsForCash(db as unknown as Db, fund, 2_000)).rejects.toThrow(
      BOND_FUND_SELL_TX
    );

    expect(db.collectionMocks.indexFunds.updateOne.mock.calls.length).toBe(2);
    expect(db.collectionMocks.bondMarketPools.updateOne.mock.calls.length).toBe(2);
    expect(receipts().updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.stringContaining(bondId.toHexString()) }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "compensated" }) }),
      undefined
    );
  });

  it("replays the same parent key without selling again", async () => {
    const opts = { idempotencyKey: "fund-sell-parent" };
    const first = await sellFundBondHoldingsForCash(
      db as unknown as Db,
      fund,
      2_000,
      new Date(),
      opts
    );
    expect(first).toEqual({ proceedsAnchor: 2_475, unitsSold: 5, bondsTouched: 1 });

    receipts().insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts().findOne.mockResolvedValue({
      _id: `fund-sell-parent:bond:${bondId.toHexString()}:5:4950`,
      status: "completed",
      fingerprint: subFingerprint(),
    });

    const poolCalls = db.collectionMocks.bondMarketPools.updateOne.mock.calls.length;
    const second = await sellFundBondHoldingsForCash(
      db as unknown as Db,
      fund,
      2_000,
      new Date(),
      opts
    );
    expect(second).toEqual({ proceedsAnchor: 2_475, unitsSold: 5, bondsTouched: 1 });
    // No second pool debit: the completed sub-flow converged on the receipt.
    expect(db.collectionMocks.bondMarketPools.updateOne.mock.calls.length).toBe(poolCalls);
  });
});
