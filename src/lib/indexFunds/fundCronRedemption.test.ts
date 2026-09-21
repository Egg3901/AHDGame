import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import {
  deriveLedgerEntries,
  fundMirrorAccount,
  type DerivableTx,
} from "@/lib/ledger/deriveFromTx";

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  getFundById: vi.fn(),
  listActiveFunds: vi.fn(),
  listServiceableFunds: vi.fn(),
  updateFundNav: vi.fn(),
  updateFundConstituents: vi.fn(),
  updateFundHoldings: vi.fn(),
  listPendingRedemptions: vi.fn(),
  insertFundTransaction: vi.fn(),
  insertFundSnapshot: vi.fn(),
  setFundStatus: vi.fn(),
  insertFundTransactionsBulk: vi.fn(),
  FUND_REDEMPTION_QUEUE_COLLECTION: "indexFundRedemptionQueue",
}));

vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn(),
  sellFundHoldingShares: vi.fn(),
}));

vi.mock("@/lib/bonds/sellFundBondUnits", () => ({
  sellFundBondHoldingsForCash: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
  emitTxBulk: vi.fn(),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  resolveIndexFundHolder: vi.fn(),
}));

vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn(),
  loadCharacterFxRate: vi.fn(),
}));

import { processQueuedRedemptions } from "./fundCron";

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

function testFund(fundId: ObjectId): IndexFund {
  return {
    _id: fundId,
    slug: "npp-redemption-test",
    name: "NPP Redemption Fund",
    tickerSymbol: "NRF",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000_000,
    reserveUnits: 0,
    cashAnchor: 10_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function nppEntry(fundId: ObjectId, nppId: ObjectId): IndexFundRedemptionQueueEntry {
  return {
    _id: new ObjectId(),
    fundId,
    holderKind: "npp",
    nppId,
    units: 10,
    requestedNavAnchor: 100,
    requestedAmountAnchor: 1_000,
    paidAmountAnchor: 0,
    status: "queued",
    unitsBurnedAtRequest: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("processQueuedRedemptions — NPP redemption ledger row", () => {
  it("emits one exact npp-subject index_fund_redeem row on the committed path", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const { listPendingRedemptions } = await import("@/lib/indexFunds/fundQueries");
    const fundId = new ObjectId();
    const nppId = new ObjectId();
    const entry = nppEntry(fundId, nppId);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValue(entry);

    const paid = await processQueuedRedemptions(db as unknown as Db, testFund(fundId), false, 7);

    expect(paid).toBe(1);

    // The NPP wallet moved by exactly the quoted payout: 10 units x 100 NAV.
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      { $inc: { nppInvestmentCashAnchor: 1_000 }, $set: { updatedAt: expect.any(Date) } }
    );

    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "index_fund_redeem",
      turn: 7,
      subjectType: "npp",
      subjectId: nppId,
      subjectName: `NPP ${nppId.toString()}`,
      amount: 1_000,
      anchorAmount: 1_000,
      currencyCode: "USD",
      counterpartyType: "system",
      counterpartyName: "NPP Redemption Fund",
      meta: {
        fundId: fundId.toString(),
        fundCurrency: "USD",
        units: 10,
        source: "cron_queue",
      },
    });

    // Same-currency pair: the shadow ledger mirrors the fund cash side off
    // meta exactly once — one mirror, never a duplicate.
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBe(`fund:${fundId.toString()}:USD`);
    const entries = deriveLedgerEntries([row as unknown as DerivableTx]);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.legs[0]).toMatchObject({
      account: `npp:${nppId.toString()}:USD`,
      amount: 1_000,
      anchorAmount: 1_000,
    });
    expect(entries[0]!.legs[1].account).toBe(`fund:${fundId.toString()}:USD`);
    expect(entries[1]!.legs[0]).toMatchObject({
      account: `fund:${fundId.toString()}:USD`,
      amount: -1_000,
      anchorAmount: -1_000,
    });
    expect(entries[1]!.legs[1]).toMatchObject({
      account: `npp:${nppId.toString()}:USD`,
      amount: 1_000,
      anchorAmount: 1_000,
    });
  });

  it("emits nothing when the NPP credit fails, and refunds the fund debit", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const { listPendingRedemptions } = await import("@/lib/indexFunds/fundQueries");
    const fundId = new ObjectId();
    const nppId = new ObjectId();
    const entry = nppEntry(fundId, nppId);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValue(entry);
    db.collection("npps");
    db.collectionMocks.npps.updateOne.mockResolvedValue({ matchedCount: 0 });

    const paid = await processQueuedRedemptions(db as unknown as Db, testFund(fundId), false, 7);

    expect(paid).toBe(0);
    expect(emitTx).not.toHaveBeenCalled();
    // Debit (-1000) then refund (+1000): no cash left the fund, no row booked.
    const incs = db.collectionMocks.indexFunds.updateOne.mock.calls.map(
      (call) => (call[1] as { $inc: { cashAnchor: number } }).$inc.cashAnchor
    );
    expect(incs).toEqual([-1_000, 1_000]);
  });

  it("stays single-sided with no mirror for a cross-currency NPP pair", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const { listPendingRedemptions } = await import("@/lib/indexFunds/fundQueries");
    const fundId = new ObjectId();
    const nppId = new ObjectId();
    const entry = nppEntry(fundId, nppId);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValue(entry);
    db.collection("npps");
    db.collectionMocks.npps.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ _id: nppId, countryId: "UK" }],
      }),
    });

    const paid = await processQueuedRedemptions(db as unknown as Db, testFund(fundId), false, 7);

    expect(paid).toBe(1);
    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "index_fund_redeem",
      subjectType: "npp",
      subjectId: nppId,
      amount: 1_000,
      anchorAmount: 1_000,
      currencyCode: "GBP",
      meta: {
        fundId: fundId.toString(),
        fundCurrency: "USD",
        units: 10,
        source: "cron_queue",
      },
    });

    // Fund books in USD, row in GBP: mirroring would invent a side, so none.
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    expect(deriveLedgerEntries([row as unknown as DerivableTx])).toHaveLength(1);
  });
});
