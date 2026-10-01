import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { deployBondReserveFromCash } from "./fundBondReserve";

vi.mock("@/lib/currency/corporationCapital", () => ({
  corpCapitalToAnchor: (n: number) => n,
  loadFxRatesRecord: vi.fn(async () => ({ USD: 1 })),
}));
vi.mock("@/lib/bonds/marketPool", () => ({
  loadBondPoolsByCurrency: vi.fn(async () => new Map()),
  loadBondQuote: vi.fn(async () => ({ askPerUnit: 1000 })),
  creditBondPool: vi.fn(async () => {}),
  advanceBondPoolSnapshot: vi.fn(),
}));

function fixture() {
  const db = createMockDb();
  const bonds = Array.from({ length: 10 }, () => ({
    _id: new ObjectId(),
    issuerType: "sovereign",
    countryId: "US",
    currencyCode: "USD",
    matured: false,
    defaulted: false,
    publicFloat: 10000,
    totalIssued: 10000000,
    faceValue: 1000,
    marketPrice: 1,
    holders: [],
    maturityTurn: 100,
  }));
  db.collection("bonds").find.mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    toArray: vi.fn(async () => bonds),
  });
  db.collection("bonds").updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collection("indexFunds").findOneAndUpdate.mockResolvedValue({ cashAnchor: 1000000 });
  const fund = {
    _id: new ObjectId(),
    name: "Test",
    slug: "test",
    kind: "broad",
    scope: "country",
    countryId: "US",
    anchorCurrencyCode: "USD",
    cashAnchor: 1000000,
    quotedNav: 100,
    unitSupply: 10000,
    holdings: [],
    targetConstituents: [],
  } as unknown as IndexFund;
  return { db, fund };
}

describe("fund bond reserve audit batching", () => {
  beforeEach(() => vi.clearAllMocks());
  it("flushes completed receipts when a later purchase fails", async () => {
    const { db, fund } = fixture();
    db.collection("indexFunds")
      .findOneAndUpdate.mockResolvedValueOnce({ cashAnchor: 900000 })
      .mockResolvedValueOnce({ cashAnchor: 800000 })
      .mockRejectedValueOnce(new Error("debit unavailable"));
    await expect(
      deployBondReserveFromCash(db as unknown as Db, fund, 0, {
        liquidityTargetEnabled: true,
        turn: 100,
      })
    ).rejects.toThrow("debit unavailable");
    expect(db.collectionMocks.indexFundTransactions.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.indexFundTransactions.insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(db.collectionMocks.financialTxLog.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.financialTxLog.insertMany.mock.calls[0][0]).toHaveLength(2);
  });

  it("surfaces receipt persistence failures", async () => {
    const { db, fund } = fixture();
    db.collection("indexFundTransactions").insertMany.mockRejectedValueOnce(
      new Error("receipt unavailable")
    );
    await expect(
      deployBondReserveFromCash(db as unknown as Db, fund, 0, {
        liquidityTargetEnabled: true,
        turn: 100,
      })
    ).rejects.toThrow("receipt unavailable");
    expect(db.collectionMocks.financialTxLog.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.financialTxLog.insertMany.mock.calls[0][0]).toHaveLength(10);
  });

  it("preserves ten ordered purchases with one write per log", async () => {
    const { db, fund } = fixture();
    const result = await deployBondReserveFromCash(db as unknown as Db, fund, 0, {
      liquidityTargetEnabled: true,
      turn: 100,
    });
    expect(result.unitsPurchased).toBeGreaterThan(0);
    expect(db.collectionMocks.indexFunds.findOneAndUpdate).toHaveBeenCalledTimes(10);
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledTimes(10);
    expect(db.collectionMocks.indexFundTransactions.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFundTransactions.insertMany).toHaveBeenCalledTimes(1);
    const transactions = db.collectionMocks.indexFundTransactions.insertMany.mock.calls[0][0];
    expect(transactions).toHaveLength(10);
    expect(db.collectionMocks.financialTxLog.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog.insertMany).toHaveBeenCalledTimes(1);
    const ledgerRows = db.collectionMocks.financialTxLog.insertMany.mock.calls[0][0];
    expect(ledgerRows).toHaveLength(10);
    expect(
      ledgerRows.every(
        (row: { turn: number; type: string }) => row.turn === 100 && row.type === "bond_purchase"
      )
    ).toBe(true);
    expect(
      transactions.reduce((sum: number, tx: { amountAnchor: number }) => sum + tx.amountAnchor, 0)
    ).toBe(result.deployedAnchor);
    expect(ledgerRows.reduce((sum: number, row: { amount: number }) => sum - row.amount, 0)).toBe(
      result.deployedAnchor
    );
  });
});
