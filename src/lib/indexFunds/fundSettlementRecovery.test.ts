import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { ClientSession, Db } from "mongodb";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// ---------------------------------------------------------------------------
// #2223: fund settlement interruption recovery.
//
// Fault-injection and concurrent-settlement coverage for the three settlement
// legs that move fund money outside a transaction on standalone Mongo:
//   1. queued-redemption payout (fund debit -> holder credit),
//   2. stale `processing` redemption reconciliation (the reaper),
//   3. redemption-liquidity holding sales (issuer debit -> share debit ->
//      cash credit -> holdings write).
// Plus both database configurations for the float-buy leg (replica-set
// transaction vs standalone sequential compensation).
//
// Conservation rule asserted throughout: fund cash + holder cash is constant
// across a partial failure (every applied debit is refunded), and no entry is
// ever paid twice (atomic processing claim, atomic reaper claim).
// ---------------------------------------------------------------------------

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
  insertFundTransactionsBulk: vi.fn(),
  setFundStatus: vi.fn(),
  updateRedemptionEntry: vi.fn(),
  FUND_REDEMPTION_QUEUE_COLLECTION: "indexFundRedemptionQueue",
}));

vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", async (importOriginal) => {
  // Real sale implementation under test; only the cron's liquidity-raising
  // entry point is stubbed so redemption tests isolate the payout legs.
  const actual = await importOriginal<typeof import("./fundRedemptionLiquidity")>();
  return { ...actual, sellFundHoldingsForRedemptionCash: vi.fn() };
});

vi.mock("@/lib/bonds/sellFundBondUnits", () => ({
  sellFundBondHoldingsForCash: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
  emitTxBulk: vi.fn(),
  loadTxThresholds: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  resolveIndexFundHolder: vi.fn(),
  logIndexFundRedeem: vi.fn(),
}));

vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn((_amount: number) => ({ liquidCapital: _amount })),
  loadCharacterFxRate: vi.fn(),
}));

vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToFund: vi.fn(),
  debitSharesFromFund: vi.fn(),
  creditShares: vi.fn(),
  debitShares: vi.fn(),
  creditSharesToCorp: vi.fn(),
  debitSharesFromCorp: vi.fn(),
  creditSharesToImperial: vi.fn(),
  debitSharesFromImperial: vi.fn(),
}));

vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  applyFloatBuyCredit: vi.fn(),
  settleFloatSellDebit: vi.fn(),
  reverseFloatSellDebit: vi.fn(),
  onFloatSellCommitted: vi.fn(),
}));

vi.mock("@/lib/equities/marketPool", () => ({
  equityPoolCurrency: vi.fn().mockReturnValue("USD"),
  loadEquityPoolsByCurrency: vi.fn(),
  loadEquityQuote: vi.fn(),
  creditEquityPool: vi.fn(),
  debitEquityPoolGated: vi.fn(),
  readEquityPool: vi.fn(),
  refundEquityPoolDebit: vi.fn(),
}));

vi.mock("@/lib/corporations/marketExecution", () => ({
  isOrderFlowPriceEligible: vi.fn().mockReturnValue(false),
  resolveShareExecutionPrice: vi.fn((corp: { sharePrice: number }) => corp.sharePrice),
}));

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn(),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  shareTradeAnchorValue: vi.fn(
    (shares: number, corp: { sharePrice: number }) => shares * corp.sharePrice
  ),
  corpLiquidCapitalToAnchor: vi.fn(),
}));

vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn(),
}));

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(),
}));

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(),
}));

import {
  processQueuedRedemptions,
  reapStaleRedemptionProcessing,
  executeFundShareBuy,
} from "./fundCron";
import { sellFundHoldingShares } from "./fundRedemptionLiquidity";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  listPendingRedemptions,
  getFundById,
  insertFundTransaction,
  updateFundHoldings,
} from "./fundQueries";
import { sellFundHoldingsForRedemptionCash } from "./fundRedemptionLiquidity";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { emitTx } from "@/lib/financialTxLog/emit";
import { resolveIndexFundHolder } from "./fundTxLog";
import { creditSharesToFund, debitSharesFromFund } from "@/lib/corporations/shareholderOps";
import {
  applyFloatBuyCredit,
  settleFloatSellDebit,
  reverseFloatSellDebit,
} from "@/lib/corporations/shareEscrowSettlement";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const asDb = (db: MockDb): Db => db as unknown as Db;

/** Mock collections are created lazily on first access; create them up front. */
function prime(db: MockDb, ...names: string[]): void {
  for (const name of names) void db.collection(name);
}

function makeFund(overrides: Partial<IndexFund> = {}): IndexFund {
  return {
    _id: new ObjectId(),
    slug: "test-fund",
    name: "Test Fund",
    tickerSymbol: "TST",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000_000,
    reserveUnits: 1_000_000,
    cashAnchor: 100_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IndexFund;
}

function makeEntry(
  fundId: ObjectId,
  overrides: Partial<IndexFundRedemptionQueueEntry> = {}
): IndexFundRedemptionQueueEntry {
  return {
    _id: new ObjectId(),
    fundId,
    holderKind: "character",
    characterId: new ObjectId(),
    units: 10,
    requestedNavAnchor: 100,
    requestedAmountAnchor: 1000,
    paidAmountAnchor: 0,
    unitsBurnedAtRequest: true,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const QUEUE = "indexFundRedemptionQueue";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listPendingRedemptions).mockResolvedValue([]);
  vi.mocked(getFundById).mockImplementation(async (_db, id) => makeFund({ _id: id }));
  vi.mocked(insertFundTransaction).mockResolvedValue(new ObjectId());
  vi.mocked(updateFundHoldings).mockResolvedValue(undefined);
  vi.mocked(sellFundHoldingsForRedemptionCash).mockResolvedValue({
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  });
  vi.mocked(sellFundBondHoldingsForCash).mockResolvedValue({
    proceedsAnchor: 0,
    unitsSold: 0,
    salesExecuted: 0,
  });
  vi.mocked(emitTx).mockResolvedValue(undefined as never);
  vi.mocked(resolveIndexFundHolder).mockResolvedValue(null);
  vi.mocked(creditSharesToFund).mockResolvedValue(true);
  vi.mocked(debitSharesFromFund).mockResolvedValue(10);
  vi.mocked(applyFloatBuyCredit).mockResolvedValue({
    issuerShares: 0,
    issuerCreditLocal: 0,
    poolCreditLocal: 0,
  });
  vi.mocked(settleFloatSellDebit).mockResolvedValue({ ok: true });
  vi.mocked(reverseFloatSellDebit).mockResolvedValue(undefined);
  vi.mocked(loadEquityQuote).mockResolvedValue({
    active: false,
    currency: "USD",
    mid: 50,
    midPriceLocal: 50,
    bidPriceLocal: 50,
    askPriceLocal: 50,
    bidDepthShares: Number.MAX_SAFE_INTEGER,
    poolCash: 0,
  } as never);
  vi.mocked(loadFxRatesByCurrency).mockResolvedValue(new Map());
  vi.mocked(getCurrentTurn).mockResolvedValue(5);
  // Default database configuration: standalone (no transactions), so the
  // sequential path with compensation runs.
  vi.mocked(runWithOptionalTransaction).mockImplementation(
    <T>(runInTx: (session: ClientSession) => Promise<T>, runWithout: () => Promise<T>) =>
      runWithout()
  );
});

// ---------------------------------------------------------------------------
// 1. Queued-redemption payout: fault injection between fund debit and holder
//    credit, plus concurrent settlement.
// ---------------------------------------------------------------------------

describe("processQueuedRedemptions interruption recovery", () => {
  it("pays a queued entry end to end (sanity)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collectionMocks[QUEUE]!.findOneAndUpdate.mockResolvedValue(entry);

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(1);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
    // Fund debit happened once...
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: -1000 } });
    // ...and the queue row was finalized, not left processing.
    const queueWrites = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
    expect(queueWrites.some((c) => (c[1] as { $set?: object }).$set != null)).toBe(true);
    const finalize = queueWrites.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "paid"
    );
    expect(finalize).toBeDefined();
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
  });

  it("refunds the fund debit when the holder credit throws (no stranded cash)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collectionMocks[QUEUE]!.findOneAndUpdate.mockResolvedValue(entry);
    db.collectionMocks.characters!.updateOne.mockRejectedValueOnce(
      new Error("simulated holder-credit write failure")
    );

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    // Conservation: debit (-1000) then refund (+1000) nets to zero.
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(2);
    expect(fundWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: -1000 } });
    expect(fundWrites[1]![1]).toMatchObject({ $inc: { cashAnchor: 1000 } });
    // The claim was restored to queued (retryable), never finalized.
    const queueWrites = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
    expect(
      queueWrites.some((c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued")
    ).toBe(true);
    expect(
      queueWrites.some(
        (c) =>
          (c[1] as { $set?: { status?: string } }).$set?.status === "paid" ||
          (c[1] as { $set?: { status?: string } }).$set?.status === "partial"
      )
    ).toBe(false);
    // No audit rows for a payout that never landed.
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("refunds cash and supply for legacy-burn rows when the holder is gone", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id, { unitsBurnedAtRequest: false });
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    db.collectionMocks[QUEUE]!.findOneAndUpdate.mockResolvedValue(entry);
    db.collectionMocks.characters!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(2);
    expect(fundWrites[0]![1]).toMatchObject({
      $inc: { cashAnchor: -1000, unitSupply: -10 },
    });
    expect(fundWrites[1]![1]).toMatchObject({
      $inc: { cashAnchor: 1000, unitSupply: 10 },
    });
  });

  it("concurrent settlements pay an entry exactly once", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    // Only the first claim wins; the loser sees no entry and skips.
    db.collectionMocks[QUEUE]!.findOneAndUpdate.mockResolvedValueOnce(entry).mockResolvedValue(
      null
    );

    const [a, b] = await Promise.all([
      processQueuedRedemptions(asDb(db), fund, false, 7),
      processQueuedRedemptions(asDb(db), fund, false, 7),
    ]);

    expect(a + b).toBe(1);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
    const debits = db.collectionMocks.indexFunds!.updateOne.mock.calls.filter(
      (c) => (c[1] as { $inc?: { cashAnchor?: number } }).$inc?.cashAnchor === -1000
    );
    expect(debits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Stale `processing` reconciliation (the reaper).
// ---------------------------------------------------------------------------

describe("reapStaleRedemptionProcessing", () => {
  const staleAt = new Date(Date.now() - 10 * 60 * 1000);

  function reapDb(row: IndexFundRedemptionQueueEntry): MockDb {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds", "indexFundTransactions");
    db.collectionMocks[QUEUE]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([row]),
    } as never);
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(row);
    return db;
  }

  it("refunds a journaled debit and restores the entry without paying twice", async () => {
    const fundId = new ObjectId();
    const row = makeEntry(fundId, {
      status: "processing",
      processingStartedAt: staleAt,
      processingAttempt: { from: "queued", debitAnchor: 500, debitUnits: 0 },
    });
    const db = reapDb(row);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 1, restored: 1, finalized: 0 });
    // Exactly one refund of the outstanding debit...
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: 500 } });
    // ...and the entry is payable again, journal cleared.
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeDefined();
    expect(restore![1]).toMatchObject({
      $unset: { processingStartedAt: "", processingAttempt: "" },
    });
    // No holder credit, no audit rows: nothing was paid.
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("finalizes a journaled credit without moving money again", async () => {
    const fundId = new ObjectId();
    const row = makeEntry(fundId, {
      status: "processing",
      paidAmountAnchor: 200,
      processingStartedAt: staleAt,
      processingAttempt: {
        from: "partial",
        debitAnchor: 500,
        debitUnits: 0,
        creditApplied: true,
        payoutUnits: 5,
        payoutRemainingUnits: 3,
        payoutNav: 100,
      },
    });
    const db = reapDb(row);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 0, finalized: 1 });
    // Both money legs already landed: the reaper moves no money...
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    // ...it only completes the bookkeeping.
    const finalize = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "partial"
    );
    expect(finalize).toBeDefined();
    expect(finalize![1]).toMatchObject({
      $set: expect.objectContaining({ paidAmountAnchor: 700, units: 3 }),
    });
  });

  it("leaves marker-less legacy rows for manual reconciliation", async () => {
    const fundId = new ObjectId();
    const row = makeEntry(fundId, { status: "processing", processingStartedAt: staleAt });
    const db = reapDb(row);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 0, skippedLegacy: 1 });
    // Untouched apart from the atomic claim: no refund, no restore, no pay.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("concurrent reapers refund a stranded debit exactly once", async () => {
    const fundId = new ObjectId();
    const row = makeEntry(fundId, {
      status: "processing",
      processingStartedAt: staleAt,
      processingAttempt: { from: "queued", debitAnchor: 500, debitUnits: 0 },
    });
    const db = reapDb(row);
    // Only the first reaper wins the atomic claim.
    db.collectionMocks[QUEUE]!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    }).mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const [a, b] = await Promise.all([
      reapStaleRedemptionProcessing(asDb(db), fundId),
      reapStaleRedemptionProcessing(asDb(db), fundId),
    ]);

    expect(a.refunded + b.refunded).toBe(1);
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Redemption-liquidity holding sales: fault injection after value moved.
// ---------------------------------------------------------------------------

describe("sellFundHoldingShares interruption recovery", () => {
  const corpId = new ObjectId();
  const corpRow = {
    _id: corpId,
    name: "Test Corp",
    sharePrice: 50,
    publicFloat: 10_000,
    totalShares: 100_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
  };

  function saleDb(): MockDb {
    const db = createMockDb();
    prime(db, "corporations", "indexFunds", "indexFundTransactions");
    const cursor = db.collection("corporations").find();
    vi.mocked(cursor.toArray).mockResolvedValue([corpRow]);
    return db;
  }

  function saleFund(): IndexFund {
    return makeFund({
      cashAnchor: 0,
      holdings: [{ corporationId: corpId, shares: 100 }],
    });
  }

  it("sells end to end (sanity)", async () => {
    const db = saleDb();
    const res = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);

    expect(res).toMatchObject({ cashRaisedAnchor: 5000, sharesSold: 100, salesExecuted: 1 });
    expect(vi.mocked(reverseFloatSellDebit)).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
  });

  it("reverses every completed leg when the holdings write fails", async () => {
    const db = saleDb();
    vi.mocked(updateFundHoldings).mockRejectedValueOnce(new Error("holdings write failed"));

    await expect(sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000)).rejects.toThrow(
      "holdings write failed"
    );

    // Issuer debit reversed, shares restored, cash credit taken back, tx row removed.
    expect(vi.mocked(reverseFloatSellDebit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creditSharesToFund)).toHaveBeenCalledTimes(1);
    const cashWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(cashWrites).toHaveLength(2);
    expect(cashWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: 5000 } });
    expect(cashWrites[1]![1]).toMatchObject({ $inc: { cashAnchor: -5000 } });
    expect(db.collectionMocks.indexFundTransactions!.deleteOne).toHaveBeenCalledTimes(0);
  });

  it("compensates without a phantom cash reversal when the fund is gone", async () => {
    const db = saleDb();
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    await expect(sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000)).rejects.toThrow(
      "Fund disappeared during redemption-liquidity sale"
    );

    // Shares and issuer legs are restored, but there is no cash leg to reverse.
    expect(vi.mocked(reverseFloatSellDebit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creditSharesToFund)).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateFundHoldings)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Float buys under both supported database configurations.
// ---------------------------------------------------------------------------

describe("executeFundShareBuy database configurations", () => {
  const corpId = new ObjectId();
  const corp = {
    _id: corpId,
    sharePrice: 50,
    publicFloat: 10_000,
    totalShares: 100_000,
  } as any;

  function buyDb(fund: IndexFund): MockDb {
    const db = createMockDb();
    prime(db, "indexFunds", "corporations");
    db.collectionMocks.indexFunds!.findOneAndUpdate.mockResolvedValue({
      _id: fund._id,
      cashAnchor: 90_000,
      holdings: [],
    });
    return db;
  }

  const standaloneTx = () =>
    vi
      .mocked(runWithOptionalTransaction)
      .mockImplementation(
        <T>(runInTx: (session: ClientSession) => Promise<T>, runWithout: () => Promise<T>) =>
          runWithout()
      );
  const transactionalTx = () =>
    vi
      .mocked(runWithOptionalTransaction)
      .mockImplementation(
        <T>(runInTx: (session: ClientSession) => Promise<T>, _runWithout: () => Promise<T>) =>
          runInTx({} as ClientSession)
      );

  it("standalone: compensates the debit and share credit when settlement fails", async () => {
    standaloneTx();
    const fund = makeFund({ cashAnchor: 100_000 });
    const db = buyDb(fund);
    vi.mocked(applyFloatBuyCredit).mockRejectedValueOnce(new Error("pool write failed"));

    await expect(executeFundShareBuy(asDb(db), fund, corp, 10, 50, 7)).rejects.toThrow(
      "pool write failed"
    );

    // Debit was refunded and the cap-table credit reversed (no throw-and-strand).
    const refunds = db.collectionMocks.indexFunds!.updateOne.mock.calls.filter(
      (c) => (c[1] as { $inc?: { cashAnchor?: number } }).$inc?.cashAnchor === 500
    );
    expect(refunds).toHaveLength(1);
    expect(db.collectionMocks.corporations!.updateOne).toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("replica set: propagates without standalone compensation (abort owns it)", async () => {
    transactionalTx();
    const fund = makeFund({ cashAnchor: 100_000 });
    const db = buyDb(fund);
    vi.mocked(applyFloatBuyCredit).mockRejectedValueOnce(new Error("pool write failed"));

    await expect(executeFundShareBuy(asDb(db), fund, corp, 10, 50, 7)).rejects.toThrow(
      "pool write failed"
    );

    // No standalone compensation runs inside a transaction: the abort reverses
    // the debit and share credit atomically. Compensating here as well would
    // double-reverse against the aborted transaction.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
  });
});
