import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BOND_FUND_BUY_TX, purchaseBondUnitsForFund } from "./purchaseBondUnitsForFund";

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
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1 }),
}));
vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return { ...actual, loadBondQuote: vi.fn() };
});

import { loadBondQuote } from "@/lib/bonds/marketPool";

let db: MockDb;
const fundId = new ObjectId();
const bondId = new ObjectId();
const fund = {
  _id: fundId,
  name: "Test Fund",
  quotedNav: 100,
  anchorCurrencyCode: "USD",
} as IndexFund;
const bond = {
  _id: bondId,
  issuerType: "corporation",
  issuerName: "Test Corp",
  currencyCode: "USD",
  marketPrice: 1,
  publicFloat: 1_000,
  holders: [],
  matured: false,
  defaulted: false,
} as unknown as Bond;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("bonds");
  db.collection("bondMarketPools");
  db.collection("indexFunds");
  db.collection("indexFundTransactions");
  db.collection("nonAtomicMoneyFlowReceipts");
  vi.mocked(loadBondQuote).mockResolvedValue({ askPerUnit: 1000 } as never);
});

function receipts() {
  return db.collectionMocks.nonAtomicMoneyFlowReceipts;
}

describe("purchaseBondUnitsForFund", () => {
  it("enforces the sovereign per-issue cap before debiting fund cash", async () => {
    const capped = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      faceValue: 1_000,
      totalIssued: 1_000_000,
      publicFloat: 1_000,
      holders: [{ fundId, units: 200 }],
      matured: false,
      defaulted: false,
    } as unknown as Bond;
    const collection = vi.fn();

    await expect(
      purchaseBondUnitsForFund({ collection } as unknown as Db, fund, capped, 51)
    ).resolves.toEqual({ ok: false, reason: "position_limit" });
    expect(collection).not.toHaveBeenCalled();
  });

  it("buys once: fund debited, holder reserved, pool credited, transaction recorded", async () => {
    const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, {
      idempotencyKey: "fund-buy-happy",
    });

    expect(result).toEqual({ ok: true, units: 10, costAnchor: 10_000, bondId: bond._id });
    // Guarded fund debit carries the flow key.
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: fundId, appliedMoneyFlowKeys: { $ne: "fund-buy-happy" } }),
      expect.objectContaining({ $inc: expect.objectContaining({ cashAnchor: -10_000 }) }),
      undefined
    );
    // Existing-holder reservation is skipped here (no fund row); the push
    // variant lands the units instead.
    const bondUpdates = db.collectionMocks.bonds.updateOne.mock.calls.map((call) => call[1]);
    expect(JSON.stringify(bondUpdates)).toContain('"holders.$.units":10');
    // Pool credit carries the same key and the purchasesIn counter.
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "USD", appliedMoneyFlowKeys: { $ne: "fund-buy-happy" } }),
      expect.objectContaining({
        $inc: expect.objectContaining({ cashLocal: 10_000, "lifetime.purchasesIn": 10_000 }),
      }),
      undefined
    );
    // Deterministic transaction row (same _id on retry, no duplicate spend).
    const txCall = db.collectionMocks.indexFundTransactions.insertOne.mock.calls[0]?.[0] as {
      _id: unknown;
      kind: string;
      amountAnchor: number;
    };
    expect(txCall.kind).toBe("bond_allocation");
    expect(txCall.amountAnchor).toBe(10_000);
    expect(txCall._id).toBeDefined();
    expect(receipts().updateOne).toHaveBeenCalledWith(
      { _id: "fund-buy-happy" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "completed" }) }),
      undefined
    );
  });

  it("replays the same key without buying again", async () => {
    const opts = { idempotencyKey: "fund-buy-replay" };
    const first = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, opts);
    expect(first.ok).toBe(true);

    receipts().insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts().findOne.mockResolvedValue({
      _id: "fund-buy-replay",
      status: "completed",
      fingerprint: `bond-fund-buy:${fundId.toHexString()}:${bondId.toHexString()}:10:10000`,
    });

    const debitCalls = db.collectionMocks.indexFunds.updateOne.mock.calls.length;
    const second = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, opts);
    expect(second).toEqual({ ok: true, units: 10, costAnchor: 10_000, bondId: bond._id });
    expect(db.collectionMocks.indexFunds.updateOne.mock.calls.length).toBe(debitCalls);
  });

  it("returns insufficient_fund_cash when the guarded debit loses the race", async () => {
    db.collectionMocks.indexFunds.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.indexFunds.findOne.mockResolvedValue(null);

    const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, {
      idempotencyKey: "fund-buy-cash",
    });

    expect(result).toEqual({ ok: false, reason: "insufficient_fund_cash" });
    // Nothing applied, so no compensation and no reservation attempt.
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
    expect(receipts().updateOne).toHaveBeenCalledWith(
      { _id: "fund-buy-cash" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) }),
      undefined
    );
  });

  it("refunds the debit when the float reservation loses the race", async () => {
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      publicFloat: 2,
      holders: [],
    });

    const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, {
      idempotencyKey: "fund-buy-reserve",
    });

    expect(result).toEqual({ ok: false, reason: "reservation_failed" });
    // The debit landed first, so the compensation refunds it with a
    // compensation key instead of stranding fund cash.
    const fundCalls = db.collectionMocks.indexFunds.updateOne.mock.calls;
    expect(fundCalls.length).toBe(2);
    expect(fundCalls[1]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashAnchor: 10_000 }) })
    );
    expect(JSON.stringify(fundCalls[1]?.[1])).toContain("compensate:fund-debit");
    expect(receipts().updateOne).toHaveBeenCalledWith(
      { _id: "fund-buy-reserve" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "compensated" }) }),
      undefined
    );
  });

  it("compensates the full prefix when the transaction insert fails", async () => {
    db.collectionMocks.indexFundTransactions.insertOne.mockRejectedValueOnce(
      new Error("transient insert failure")
    );

    await expect(
      purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, {
        idempotencyKey: "fund-buy-tx",
      })
    ).rejects.toThrow(BOND_FUND_BUY_TX);

    // Prefix reversed: fund refunded, units released, pool un-credited.
    // (Pool calls: money-neutral shell, credit, then the revert.)
    expect(db.collectionMocks.indexFunds.updateOne.mock.calls.length).toBe(2);
    const poolCalls = db.collectionMocks.bondMarketPools.updateOne.mock.calls;
    expect(poolCalls.length).toBe(3);
    expect(poolCalls[2]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashLocal: -10_000 }) })
    );
    expect(receipts().updateOne).toHaveBeenCalledWith(
      { _id: "fund-buy-tx" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "compensated" }) }),
      undefined
    );
  });

  it("throws a key conflict when the key is reused with a different fingerprint", async () => {
    const { MoneyFlowKeyConflictError } = await import("@/lib/db/nonAtomicMoneyFlow");
    receipts().insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts().findOne.mockResolvedValue({
      _id: "fund-buy-conflict",
      status: "completed",
      fingerprint: "bond-fund-buy:something-else",
    });

    await expect(
      purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 10, {
        idempotencyKey: "fund-buy-conflict",
        fingerprint: "bond-fund-buy:this-attempt",
      })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(db.collectionMocks.indexFunds.updateOne).not.toHaveBeenCalled();
  });
});
