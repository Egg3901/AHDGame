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
  retryQuarantinedHolderReversal,
  reconcileQuarantinedRedemption,
  executeFundShareBuy,
} from "./fundCron";
import { clearPendingLiquiditySale, sellFundHoldingShares } from "./fundRedemptionLiquidity";
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

/** Net fund cashAnchor $inc across every indexFunds.updateOne (debits negative). */
function fundCashNet(db: MockDb): number {
  return db.collectionMocks.indexFunds!.updateOne.mock.calls.reduce(
    (sum, call) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sum + (((call[1] as any)?.$inc?.cashAnchor as number | undefined) ?? 0),
    0
  );
}

/** Net holder cash $inc across character and NPP credit writes. */
function holderCashNet(db: MockDb): number {
  const characters = db.collectionMocks.characters!.updateOne.mock.calls.reduce(
    (sum, call) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sum + (((call[1] as any)?.$inc?.liquidCapital as number | undefined) ?? 0),
    0
  );
  const npps = (db.collectionMocks.npps?.updateOne.mock.calls ?? []).reduce(
    (sum, call) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sum + (((call[1] as any)?.$inc?.nppInvestmentCashAnchor as number | undefined) ?? 0),
    0
  );
  return characters + npps;
}

/**
 * Process-boundary claim capture. The payout claim mints the attempt key
 * inside the call, so tests that must control marker/receipt truth capture
 * the key from the claim write and serve the pre-credit ownership fence a
 * live row (or a stolen one, via `fenceRow`).
 */
function captureClaim(
  db: MockDb,
  entry: IndexFundRedemptionQueueEntry,
  fenceRow?: (key: string, startedAt: Date) => object | null
): { getKey: () => string | null } {
  let key: string | null = null;
  let startedAt: Date | null = null;
  db.collectionMocks[QUEUE]!.findOneAndUpdate.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_filter: unknown, update: any) => {
      startedAt = update?.$set?.processingStartedAt ?? null;
      key = update?.$set?.processingAttempt?.attemptKey ?? null;
      return entry;
    }
  );
  db.collectionMocks[QUEUE]!.find.mockReturnValue(
    chainableRows(() => {
      if (!key || !startedAt) return [];
      if (fenceRow) {
        const row = fenceRow(key, startedAt);
        return row ? [row] : [];
      }
      return [
        {
          _id: entry._id,
          status: "processing",
          processingStartedAt: startedAt,
          processingAttempt: { attemptKey: key },
        },
      ];
    }) as never
  );
  return { getKey: () => key };
}

/** Serve getFundById with a debit marker for every key in `keys`. */
function fundWithMarker(
  fund: IndexFund,
  entry: IndexFundRedemptionQueueEntry,
  keys: (string | null)[],
  amountAnchor = 1000,
  units = 0
): IndexFund {
  const markers: Record<string, unknown> = {};
  for (const key of keys) {
    if (!key) continue;
    markers[key] = {
      amountAnchor,
      units,
      queueEntryId: entry._id,
      markedAt: new Date(),
    };
  }
  return makeFund({ _id: fund._id, redemptionDebitMarkers: markers } as Partial<IndexFund>);
}

/** Holder doc carrying (or pointedly not carrying) this attempt's receipt. */
function holderDocWithReceipt(holderId: ObjectId, receipt: object | null): object {
  return {
    _id: holderId,
    redemptionReceipts: receipt ? [receipt] : [],
  };
}

/**
 * Find-cursor stub supporting the `.find().project().toArray()` chain the
 * recovery source uses for its projected truth reads (NPP docs are 31 KB;
 * only the receipts array is read). Plain `{ toArray }` stubs throw
 * `project is not a function` inside the code under test.
 */
function chainableRows(docs: unknown[] | (() => unknown)): object {
  const resolve = async () => (typeof docs === "function" ? docs() : docs);
  const cursor: { toArray: ReturnType<typeof vi.fn>; project: ReturnType<typeof vi.fn> } = {
    toArray: vi.fn().mockImplementation(resolve),
    project: vi.fn().mockImplementation(() => cursor),
  };
  return cursor;
}

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
    bondsTouched: 0,
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
// 1. Queued-redemption payout: process-boundary fault injection.
//
// Each test kills the attempt at one interruption boundary (credit throw,
// lost finalize race, failed evidence, reaped row, restart after restore)
// and asserts the resolution from durable truth: the fund-side debit marker
// (atomic with the debit) and the holder-side credit receipt (atomic with
// the credit). Conservation asserted throughout: fund cash + holder cash is
// constant, and no entry is ever credited twice.
// ---------------------------------------------------------------------------

describe("processQueuedRedemptions interruption recovery", () => {
  it("pays a queued entry end to end (sanity + round-trip budget)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(1);
    const attemptKey = claim.getKey();
    expect(typeof attemptKey).toBe("string");
    // The claim journals the attempt key exactly once.
    expect(db.collectionMocks[QUEUE]!.findOneAndUpdate).toHaveBeenCalledTimes(1);
    // Fund debit happened once, WITH its marker in the same write...
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(2);
    expect(fundWrites[0]![0]).toMatchObject({
      _id: fund._id,
      cashAnchor: { $gte: 1000 },
      [`redemptionDebitMarkers.${attemptKey}`]: { $exists: false },
    });
    expect(fundWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: -1000 } });
    // ...and the marker was cleared by the batched end-of-pass cleanup, which
    // moves no money.
    expect(fundWrites[1]![1]).toMatchObject({
      $unset: { [`redemptionDebitMarkers.${attemptKey}`]: "" },
    });
    expect(fundCashNet(db)).toBe(-1000);
    // Exactly one idempotent holder credit, receipt guarded...
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
    const credit = db.collectionMocks.characters!.updateOne.mock.calls[0]!;
    expect(credit[0]).toMatchObject({
      _id: entry.characterId,
      "redemptionReceipts.key": { $ne: attemptKey },
    });
    expect(credit[1]).toMatchObject({ $inc: { liquidCapital: 1000 } });
    expect(holderCashNet(db)).toBe(1000);
    // ...and the queue row was finalized under this attempt's key, not left
    // processing.
    const queueWrites = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
    const finalize = queueWrites.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "paid"
    );
    expect(finalize).toBeDefined();
    expect(finalize![0]).toMatchObject({
      _id: entry._id,
      status: "processing",
      "processingAttempt.attemptKey": attemptKey,
    });
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
    // Round-trip budget, per payout: the two old journal-confirm writes are
    // gone; the pre-credit fence read and the batched marker cleanup take
    // their place. Net collection ops per payout are unchanged at 7: reaper
    // stale scan, claim, debit, fence read, credit, finalize, cleanup.
    expect(db.collectionMocks[QUEUE]!.find.mock.calls).toHaveLength(2);
    expect(db.collectionMocks[QUEUE]!.findOneAndUpdate.mock.calls).toHaveLength(1);
    expect(db.collectionMocks[QUEUE]!.updateOne.mock.calls).toHaveLength(1);
    expect(db.collectionMocks.indexFunds!.updateOne.mock.calls).toHaveLength(2);
    expect(db.collectionMocks.characters!.updateOne.mock.calls).toHaveLength(1);
    // No receipt reads on the happy path: truth reads are recovery-only.
    expect(db.collectionMocks.characters!.find.mock.calls).toHaveLength(0);
  });

  it("refunds the fund debit when the holder credit throws (no stranded cash)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);
    // The debit landed (marker present) but the credit threw mid-write; the
    // holder exists and carries no receipt, so the credit never landed.
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      fundWithMarker(fund, entry, [claim.getKey()])
    );
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows([holderDocWithReceipt(entry.characterId!, null)]) as never
    );
    db.collectionMocks.characters!.updateOne.mockRejectedValueOnce(
      new Error("simulated holder-credit write failure")
    );

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    // Conservation: debit (-1000) then exactly one marker-atomic refund
    // (+1000) nets to zero; the single holder credit attempt threw, so no
    // holder write applied (mock.calls still records the failed attempt's
    // args, so attempt count — not holderCashNet — is the proof here).
    expect(fundCashNet(db)).toBe(0);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
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
    captureClaim(db, entry);
    db.collectionMocks.characters!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows([holderDocWithReceipt(entry.characterId!, null)]) as never
    );

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    expect(fundCashNet(db)).toBe(0);
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
    // Only the first claim wins; the loser sees no entry and skips. The
    // fence serves the winner's live row.
    let claimed = false;
    let key: string | null = null;
    let startedAt: Date | null = null;
    db.collectionMocks[QUEUE]!.findOneAndUpdate.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (_filter: unknown, update: any) => {
        if (claimed) return null;
        claimed = true;
        startedAt = update?.$set?.processingStartedAt ?? null;
        key = update?.$set?.processingAttempt?.attemptKey ?? null;
        return entry;
      }
    );
    db.collectionMocks[QUEUE]!.find.mockReturnValue(
      chainableRows(() => {
        if (!key || !startedAt) return [];
        return [
          {
            _id: entry._id,
            status: "processing",
            processingStartedAt: startedAt,
            processingAttempt: { attemptKey: key },
          },
        ];
      }) as never
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
    expect(fundCashNet(db)).toBe(-1000);
    expect(holderCashNet(db)).toBe(1000);
  });

  it("aborts without crediting when the row was reaped mid-payout (fence)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    // A reaper claimed the row past the lease after this attempt's debit: the
    // fence sees foreign ownership and the owner must not move holder money
    // the reaper already accounted for.
    captureClaim(db, entry, () => ({
      _id: entry._id,
      status: "processing",
      processingStartedAt: new Date(0),
      processingAttempt: { attemptKey: "rx-stolen-by-reaper" },
    }));

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    // No holder credit was ever attempted...
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(holderCashNet(db)).toBe(0);
    // ...the debit was refunded exactly once (conservation)...
    expect(fundCashNet(db)).toBe(0);
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(2);
    expect(fundWrites[1]![1]).toMatchObject({ $inc: { cashAnchor: 1000 } });
    // ...and the row was left for the reaper, never finalized nor restored
    // by the owner (restoring would clobber the reaper's resolution).
    const queueWrites = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
    expect(
      queueWrites.some((c) =>
        ["paid", "partial", "queued"].includes(
          (c[1] as { $set?: { status?: string } }).$set?.status ?? ""
        )
      )
    ).toBe(false);
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("never audits twice when the finalize loses a resolver race", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    captureClaim(db, entry);
    // A concurrent resolver (reaper) finalized or restored the row first: the
    // conditional finalize matches nothing.
    db.collectionMocks[QUEUE]!.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    // Money moved exactly once (debit + idempotent credit, no refund: a
    // refund here would mint against the winner's books)...
    expect(fundCashNet(db)).toBe(-1000);
    expect(holderCashNet(db)).toBe(1000);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
    // ...but the loser emits no evidence and counts nothing.
    expect(paid).toBe(0);
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("heals the audit gap when evidence fails after finalize", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);
    // Death between finalize and the audit row: the marker is still present
    // (cleanup never ran) and the receipt proves the credit landed.
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      fundWithMarker(fund, entry, [claim.getKey()])
    );
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows(() => [
        holderDocWithReceipt(entry.characterId!, {
          key: claim.getKey(),
          amountAnchor: 1000,
          units: 10,
          remainingUnits: 0,
          nav: 100,
        }),
      ]) as never
    );
    vi.mocked(insertFundTransaction).mockRejectedValueOnce(new Error("audit write failed"));

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    // The payout completed on retry of the evidence only: money moved once,
    // nothing was refunded, the holder was credited exactly once...
    expect(paid).toBe(1);
    expect(fundCashNet(db)).toBe(-1000);
    expect(holderCashNet(db)).toBe(1000);
    const creditIncs = db.collectionMocks.characters!.updateOne.mock.calls.filter(
      (c) => (c[1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === 1000
    );
    expect(creditIncs).toHaveLength(1);
    // ...and the evidence gap healed itself on the second attempt.
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(2);
  });

  it("restart after a restored attempt pays exactly once (conservation)", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);
    // Pass 1 dies at the credit write with the debit outstanding and no
    // receipt: refund once, restore, pay nothing.
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      fundWithMarker(fund, entry, [claim.getKey()])
    );
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows([holderDocWithReceipt(entry.characterId!, null)]) as never
    );
    db.collectionMocks.characters!.updateOne.mockRejectedValueOnce(
      new Error("process died at the holder credit")
    );

    const first = await processQueuedRedemptions(asDb(db), fund, false, 7);
    expect(first).toBe(0);
    expect(fundCashNet(db)).toBe(0);
    // The pass-1 credit attempt threw before applying (mock.calls records its
    // args anyway); clear it so pass-2 accounting counts applied writes only.
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(1);
    db.collectionMocks.characters!.updateOne.mockClear();

    // Pass 2 (the restart) replays the restored entry to completion.
    const second = await processQueuedRedemptions(asDb(db), fund, false, 7);
    expect(second).toBe(1);
    // Across both passes: exactly one debit outstanding, exactly one credit.
    expect(fundCashNet(db)).toBe(-1000);
    expect(holderCashNet(db)).toBe(1000);
    const creditIncs = db.collectionMocks.characters!.updateOne.mock.calls.filter(
      (c) => (c[1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === 1000
    );
    expect(creditIncs).toHaveLength(1);
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
  });

  it("leaves the payout for the reaper when the holder receipt is unreadable", async () => {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    captureClaim(db, entry);
    // The credit write finds no holder (matched 0), and the receipt read
    // itself fails: the credit state is unprovable, so the owner must not
    // refund (could double-refund against a concurrent resolver) or restore
    // (could replay a paid entry).
    db.collectionMocks.characters!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const unreadable = chainableRows([]) as {
      toArray: ReturnType<typeof vi.fn>;
      project: ReturnType<typeof vi.fn>;
    };
    unreadable.toArray.mockRejectedValue(new Error("receipt read failed"));
    db.collectionMocks.characters!.find.mockReturnValue(unreadable as never);

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    expect(paid).toBe(0);
    // Exactly one fund write (the debit): no refund was attempted.
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![1]).toMatchObject({ $inc: { cashAnchor: -1000 } });
    // The debit stays outstanding as an explicit reconciliation obligation
    // for the reaper (never silently conserved, never restored by the owner).
    expect(fundCashNet(db)).toBe(-1000);
    expect(db.collectionMocks[QUEUE]!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("finalizes through a reaper quarantine when the owner stalls between fence and credit", async () => {
    // Fault injection for the #2223 lease race under the fail-closed root
    // protocol: the owner passes the pre-credit fence, stalls, the reaper
    // quarantines the row (marker KEPT, same attempt key), then the owner
    // resumes and lands its holder credit. The credit is still BACKED, and
    // the owner's conditional finalize still matches the quarantine (same
    // key), so the payout completes exactly once: no reversal, no replay,
    // no double-pay.
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);

    // Holder receipt state, mutated by the credit write below.
    const receipts: Array<{ key: string }> = [];
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows(() => [{ _id: entry.characterId, redemptionReceipts: [...receipts] }]) as never
    );
    // Marker truth: kept by the fail-closed reaper throughout.
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      fundWithMarker(fund, entry, [claim.getKey()])
    );

    db.collectionMocks.characters!.updateOne.mockImplementationOnce(
      async (
        _filter: unknown,
        update: { $addToSet?: { redemptionReceipts?: { key: string } } }
      ) => {
        // The owner stalled between fence and credit: the reaper runs now
        // (conditional quarantine, marker kept, same attempt key), through
        // the same mocks. No refund, no restore.
        await db.collectionMocks[QUEUE]!.updateOne(
          { _id: entry._id, status: "processing" },
          {
            $set: {
              "processingAttempt.quarantined": true,
              "processingAttempt.outstandingAnchor": 1000,
              "processingAttempt.outstandingUnits": 0,
            },
          }
        );
        // The owner resumes: its credit lands backed by the kept marker.
        const added = update?.$addToSet?.redemptionReceipts as { key: string } | undefined;
        if (added) receipts.push(added);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    // Paid exactly once on the stalled attempt itself: debit (-1000) plus
    // one backed credit (+1000), marker cleared on the owner's pass.
    expect(paid).toBe(1);
    expect(fundCashNet(db)).toBe(-1000);
    expect(holderCashNet(db)).toBe(1000);
    const holderWrites = db.collectionMocks.characters!.updateOne.mock.calls;
    expect(holderWrites).toHaveLength(1);
    expect(holderWrites[0]![1]).toMatchObject({ $inc: { liquidCapital: 1000 } });
    expect(holderWrites[0]![1]).not.toHaveProperty("$pull");
    // The quarantine flag was set inline, then the finalize won under the
    // same attempt key and cleared the journal: the row is paid, not
    // quarantined, and the marker cleanup ran.
    const queueWrites = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
    expect(
      queueWrites.some(
        (c) =>
          (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
            "processingAttempt.quarantined"
          ] === true
      )
    ).toBe(true);
    const finalize = queueWrites.find(
      (c) =>
        ((c[1] as { $set?: { status?: string } }).$set?.status === "paid" ||
          (c[1] as { $set?: { status?: string } }).$set?.status === "partial") &&
        (c[1] as { $unset?: Record<string, string> }).$unset?.processingAttempt === ""
    );
    expect(finalize).toBeDefined();
    const markerClear = db.collectionMocks.indexFunds!.updateOne.mock.calls.find((c) =>
      Object.keys((c[1] as { $unset?: Record<string, string> }).$unset ?? {}).some((k) =>
        k.includes(claim.getKey() ?? "rx-never")
      )
    );
    expect(markerClear).toBeDefined();
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
  });

  it("pays redemptions from cash while liquidity raising is quarantined", async () => {
    // Supported-configuration decision (#2223): a quarantined liquidity
    // journal refuses NEW sales but never blocks payouts from cash already
    // on hand. Holders keep being paid (pro-rata); only raising stops.
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund({
      cashAnchor: 500,
      holdings: [{ corporationId: new ObjectId(), shares: 100 }],
    });
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    captureClaim(db, entry);
    vi.mocked(sellFundHoldingsForRedemptionCash).mockResolvedValue({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
      liquidityQuarantined: true,
    });

    const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

    // The fund was refreshed (mock) to 100k cash after the refused raise and
    // the queue paid from it: quarantine defers raising, it does not strand
    // the queue.
    expect(paid).toBe(1);
    expect(vi.mocked(sellFundHoldingsForRedemptionCash)).toHaveBeenCalledTimes(1);
    expect(holderCashNet(db)).toBe(1000);
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
  });

  it("quarantines the row when a manual refund races the owner and the reversal fails, and a retry restores it for exactly-once replay", async () => {
    // Process-boundary fault injection for the remaining unbacked-credit
    // race: the owner passes the fence, stalls, an operator's manual
    // refund-and-restore on the misdiagnosed row refunds the debit and
    // restores it (the reaper itself never refunds, so this manual race is
    // the only way a live owner's credit lands unbacked), the owner resumes
    // and lands its holder credit UNBACKED, the finalize loses, and the
    // reversal write itself FAILS. The owner must quarantine the restored
    // row durably (never leave it replayable behind a warn log), and a new
    // worker's retry must reverse-verify-restore so the replay pays exactly
    // once with nothing silently conserved.
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fund = makeFund();
    const entry = makeEntry(fund._id);
    vi.mocked(listPendingRedemptions).mockResolvedValue([entry]);
    const claim = captureClaim(db, entry);
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    try {
      // Holder receipt state, mutated only by APPLIED writes below.
      let receipts: Array<{ key: string }> = [];
      db.collectionMocks.characters!.find.mockReturnValue(
        chainableRows(() => [
          { _id: entry.characterId, redemptionReceipts: [...receipts] },
        ]) as never
      );
      let markerPresent = true;
      vi.mocked(getFundById).mockImplementation(async (_db, id) =>
        markerPresent ? fundWithMarker(fund, entry, [claim.getKey()]) : makeFund({ _id: id })
      );

      // Applied holder economics (rejected writes change nothing).
      let appliedHolderNet = 0;
      let appliedCredits = 0;
      let appliedReversals = 0;
      const applyHolderWrite = async (_filter: unknown, update: any) => {
        const pulled = update?.$pull?.redemptionReceipts?.key as string | undefined;
        if (pulled) {
          receipts = receipts.filter((r) => r.key !== pulled);
          appliedHolderNet -= 1000;
          appliedReversals++;
        }
        const added = update?.$addToSet?.redemptionReceipts as { key: string } | undefined;
        if (added) {
          receipts.push(added);
          appliedHolderNet += 1000;
          appliedCredits++;
        }
        return { matchedCount: 1, modifiedCount: 1 };
      };
      db.collectionMocks.characters!.updateOne.mockImplementation(applyHolderWrite);
      db.collectionMocks.characters!.updateOne.mockImplementationOnce(
        async (_filter: unknown, update: any) => {
          // The owner stalled between fence and credit: the operator's
          // manual refund-and-restore runs now (marker-atomic refund, then
          // conditional restore), through the same mocks.
          markerPresent = false;
          await db.collectionMocks.indexFunds!.updateOne(
            { _id: fund._id },
            { $inc: { cashAnchor: 1000 } }
          );
          await db.collectionMocks[QUEUE]!.updateOne(
            { _id: entry._id },
            { $set: { status: "queued" } }
          );
          // The owner resumes: its credit lands after the refund, unbacked.
          return applyHolderWrite(_filter, update);
        }
      );
      // The reversal write itself fails at the process boundary.
      db.collectionMocks.characters!.updateOne.mockRejectedValueOnce(
        new Error("simulated reversal write failure")
      );

      // Queue writes in order: 1 manual restore (applied), 2 owner finalize
      // (lost race), 3 owner quarantine (applied), 4+ retry restore / replay
      // finalize (applied).
      let queueWrites = 0;
      db.collectionMocks[QUEUE]!.updateOne.mockImplementation(async () => {
        queueWrites++;
        if (queueWrites === 2) return { matchedCount: 0, modifiedCount: 0 };
        return { matchedCount: 1, modifiedCount: 1 };
      });

      const paid = await processQueuedRedemptions(asDb(db), fund, false, 7);

      expect(paid).toBe(0);
      const attemptKey = claim.getKey();
      expect(typeof attemptKey).toBe("string");
      // The unbacked credit is still out, the fund debit was refunded: net
      // fund zero, holder +1000, receipt still present.
      expect(fundCashNet(db)).toBe(0);
      expect(appliedHolderNet).toBe(1000);
      expect(appliedCredits).toBe(1);
      expect(appliedReversals).toBe(0);
      expect(receipts.some((r) => r.key === attemptKey)).toBe(true);
      // The loser emits no evidence and counts nothing.
      expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
      // The restored row was quarantined durably, conditional on it still
      // sitting in the restored state: same status and unpaid figures, so
      // the write can never clobber a newer attempt or a paid row.
      const queueWritesLog = db.collectionMocks[QUEUE]!.updateOne.mock.calls;
      const quarantine = queueWritesLog.find(
        (c) =>
          (c[1] as { $set?: { status?: string } }).$set?.status === "processing" &&
          (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
            "processingAttempt.quarantined"
          ] === true
      );
      expect(quarantine).toBeDefined();
      expect(quarantine![0]).toMatchObject({
        _id: entry._id,
        status: "queued",
        paidAmountAnchor: 0,
        units: 10,
      });
      expect(quarantine![1]).toMatchObject({
        $set: expect.objectContaining({
          status: "processing",
          "processingAttempt.quarantined": true,
          "processingAttempt.outstandingAnchor": 0,
          "processingAttempt.unreversedReceiptKey": attemptKey,
          "processingAttempt.unreversedAmountAnchor": 1000,
          "processingAttempt.unreversedNative": 1000,
          "processingAttempt.unreversedUnits": 10,
        }),
      });
      // Exactly one return to queued, and it is the manual inline restore:
      // the owner never restored the row itself (restoring would replay the
      // paid entry).
      const queuedRestores = queueWritesLog.filter(
        (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
      );
      expect(queuedRestores).toHaveLength(1);
      // The obligation is explicit reconciliation, never silent
      // conservation.
      expect(warnings.some((w) => /row quarantined, manual reconciliation required/.test(w))).toBe(
        true
      );
      expect(warnings.some((w) => /conserved/i.test(w))).toBe(false);
      const writesBeforeRetry = db.collectionMocks[QUEUE]!.updateOne.mock.calls.length;

      // A new worker retries the reversal through the journaled figures.
      // QUEUE.findOne serves the quarantined row until the retry restores it.
      let quarantineLive = true;
      const quarantinedRow = {
        ...entry,
        status: "processing",
        processingStartedAt: new Date(),
        processingAttempt: {
          from: "queued",
          attemptKey,
          quarantined: true,
          outstandingAnchor: 0,
          outstandingUnits: 0,
          unreversedReceiptKey: attemptKey,
          unreversedAmountAnchor: 1000,
          unreversedNative: 1000,
          unreversedUnits: 10,
        },
      };
      db.collectionMocks[QUEUE]!.findOne.mockImplementation(async () => {
        if (!quarantineLive) return null;
        return quarantinedRow;
      });

      const outcome = await retryQuarantinedHolderReversal(asDb(db), fund, entry._id, false);

      expect(outcome).toBe("restored");
      // Exactly one applied reversal of the unbacked credit, verified gone.
      expect(appliedReversals).toBe(1);
      expect(appliedHolderNet).toBe(0);
      expect(receipts.some((r) => r.key === attemptKey)).toBe(false);
      expect(warnings.some((w) => /reversal verified.*row restored/.test(w))).toBe(true);
      // The retry restored the row to payable only after proving both legs
      // clean (no receipt, no marker).
      const retryRestore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.slice(
        writesBeforeRetry
      ).find((c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued");
      expect(retryRestore).toBeDefined();
      expect(retryRestore![0]).toMatchObject({
        _id: entry._id,
        status: "processing",
        "processingAttempt.attemptKey": attemptKey,
      });
      quarantineLive = false;

      // The replay pays exactly once: no double pay, no missing money.
      const replayed = await processQueuedRedemptions(asDb(db), fund, false, 7);
      expect(replayed).toBe(1);
      expect(fundCashNet(db)).toBe(-1000);
      expect(appliedHolderNet).toBe(1000);
      expect(appliedCredits).toBe(2);
      expect(appliedReversals).toBe(1);
      expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps a quarantined row non-replayable when the retry cannot verify the reversal", async () => {
    // Fail-closed retry: the receipt is still out and the reversal write
    // keeps failing, so the quarantine stands, no money moves, and the
    // reaper still treats the row as terminal.
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = makeEntry(fundId, {
      characterId: holderId,
      status: "processing",
      processingStartedAt: new Date(),
      processingAttempt: {
        from: "queued",
        attemptKey: "rx-unreversed-1",
        quarantined: true,
        outstandingAnchor: 0,
        outstandingUnits: 0,
        unreversedReceiptKey: "rx-unreversed-1",
        unreversedAmountAnchor: 1000,
        unreversedNative: 1000,
        unreversedUnits: 10,
      },
    });
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(row);
    db.collectionMocks.characters!.find.mockReturnValue(
      chainableRows([
        holderDocWithReceipt(holderId, {
          key: "rx-unreversed-1",
          amountAnchor: 1000,
          units: 10,
          remainingUnits: 0,
          nav: 100,
        }),
      ]) as never
    );
    vi.mocked(getFundById).mockImplementation(async (_db, id) => makeFund({ _id: id }));
    db.collectionMocks.characters!.updateOne.mockRejectedValue(new Error("reversal still failing"));

    const outcome = await retryQuarantinedHolderReversal(
      asDb(db),
      makeFund({ _id: fundId }),
      row._id,
      false
    );

    expect(outcome).toBe("still-quarantined");
    // No refund of a quarantined row, no restore, no replay: the failed
    // reversal moved nothing.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks[QUEUE]!.updateOne).not.toHaveBeenCalled();

    // The reaper still treats the owner-quarantined row as terminal: never
    // retried, never refunded, never restored.
    const reapDb = createMockDb();
    prime(reapDb, QUEUE, "characters", "indexFunds");
    const stale = { ...row, processingStartedAt: new Date(Date.now() - 10 * 60 * 1000) };
    reapDb.collectionMocks[QUEUE]!.find.mockReturnValue(chainableRows([stale]) as never);
    reapDb.collectionMocks[QUEUE]!.findOne.mockResolvedValue(stale);
    const result = await reapStaleRedemptionProcessing(asDb(reapDb), fundId);
    expect(result).toMatchObject({ reaped: 0, quarantined: 1 });
    expect(reapDb.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(reapDb.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(reapDb.collectionMocks[QUEUE]!.updateOne.mock.calls).toHaveLength(1);

    // An ordinary (non-quarantined) row is not a retry target.
    const plainDb = createMockDb();
    prime(plainDb, QUEUE, "characters", "indexFunds");
    plainDb.collectionMocks[QUEUE]!.findOne.mockResolvedValue(makeEntry(fundId));
    expect(
      await retryQuarantinedHolderReversal(asDb(plainDb), makeFund({ _id: fundId }), row._id, false)
    ).toBe("not-quarantined");
  });
});

// ---------------------------------------------------------------------------
// 2. Stale `processing` reconciliation (the reaper): restart fault injection.
//
// Each test hand-builds the exact durable state a process death leaves
// behind (journal + fund marker + holder receipt, in every combination) and
// asserts the reaper resolves it from marker/receipt truth: restore when
// nothing is outstanding, money-free finalize when the credit provably
// landed, fail-closed quarantine (marker kept, never refunded or restored)
// whenever the holder credit is unproven — including a clean receipt-absent
// read, because on standalone Mongo a lease expiry is not proof the owner
// died and a stalled owner may still credit. Conservation and
// no-double-credit/refund throughout; a truly dead owner is resolved later
// through the explicit manual `reconcileQuarantinedRedemption`, covered in
// section 2b.
// ---------------------------------------------------------------------------

describe("reapStaleRedemptionProcessing", () => {
  const staleAt = new Date(Date.now() - 10 * 60 * 1000);
  const ATTEMPT = "rx-dead-attempt-1";

  function reapDb(
    row: IndexFundRedemptionQueueEntry,
    fundMarkers: Record<string, object> = {},
    holderReceipts: object[] | null = []
  ): MockDb {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds", "indexFundTransactions");
    db.collectionMocks[QUEUE]!.find.mockReturnValue(chainableRows([row]) as never);
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(row);
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      makeFund({ _id: id, redemptionDebitMarkers: fundMarkers } as Partial<IndexFund>)
    );
    if (holderReceipts !== null) {
      db.collectionMocks.characters!.find.mockReturnValue(
        chainableRows([
          {
            _id: row.characterId,
            redemptionReceipts: holderReceipts,
          },
        ]) as never
      );
    }
    return db;
  }

  function journaledRow(
    fundId: ObjectId,
    overrides: Partial<IndexFundRedemptionQueueEntry> = {}
  ): IndexFundRedemptionQueueEntry {
    return makeEntry(fundId, {
      status: "processing",
      processingStartedAt: staleAt,
      processingAttempt: { from: "queued", attemptKey: ATTEMPT },
      ...overrides,
    });
  }

  it("restores with no money movement when the owner died before the debit", async () => {
    const fundId = new ObjectId();
    const row = journaledRow(fundId);
    const db = reapDb(row, {}, []);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 1, finalized: 0 });
    // No debit was ever outstanding: zero fund writes (not even cleanup).
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(getFundById)).toHaveBeenCalled();
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeDefined();
    expect(restore![0]).toMatchObject({
      _id: row._id,
      status: "processing",
      "processingAttempt.attemptKey": ATTEMPT,
    });
    expect(restore![1]).toMatchObject({
      $unset: { processingStartedAt: "", processingAttempt: "" },
    });
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("quarantines a marked debit with no receipt instead of refunding it", async () => {
    const fundId = new ObjectId();
    // Death after the fund debit, before the holder credit. The receipt
    // reads cleanly absent, but that is NOT proof the owner will never
    // credit: on standalone Mongo the lease expiry proves nothing about the
    // owner's liveness, and refunding now would mint money if a stalled
    // owner resumes. Fail closed: keep the marker, quarantine the row.
    const row = journaledRow(fundId);
    const db = reapDb(
      row,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({
      reaped: 1,
      refunded: 0,
      restored: 0,
      finalized: 0,
      quarantined: 1,
    });
    // The debit marker is kept: zero fund writes, zero money movement.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(fundCashNet(db)).toBe(0);
    // The quarantine is conditional on still owning this attempt, so a
    // delayed reaper can never clobber an owner that resolved in the
    // meantime — and it stamps the outstanding debit as the explicit
    // reconciliation obligation (never silently conserved).
    const flag = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) =>
        (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
          "processingAttempt.quarantined"
        ] === true
    );
    expect(flag).toBeDefined();
    expect(flag![0]).toMatchObject({
      _id: row._id,
      status: "processing",
      "processingAttempt.attemptKey": ATTEMPT,
    });
    expect(flag![1]).toMatchObject({
      $set: expect.objectContaining({
        "processingAttempt.quarantined": true,
        "processingAttempt.outstandingAnchor": 500,
        "processingAttempt.outstandingUnits": 0,
      }),
    });
    // No restore (would replay a paid entry), no holder credit, no audit.
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeUndefined();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("restores a marker-less journaled row with no money movement", async () => {
    const fundId = new ObjectId();
    // The journal is intact but no debit is outstanding: the owner died
    // before the debit, or a live-owner/manual path already refunded it
    // (the reaper itself never refunds, so a gone marker means nothing is
    // left to refund). Restore with no money movement.
    const db = reapDb(journaledRow(fundId), {}, []);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 1, finalized: 0 });
    // Zero money movement: there was never (or is no longer) a debit out.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(fundCashNet(db)).toBe(0);
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeDefined();
  });

  it("quarantines when the holder was deleted and recreated, then manual reconciliation replays exactly once", async () => {
    // Delete/recreate ambiguity: the credit may have landed on a holder
    // document that no longer exists. The recreated doc carries no receipt
    // (reads "absent"), but the reaper cannot distinguish that from a
    // stalled owner about to credit — so it quarantines with the marker
    // kept, and the operator resolves the truly dead owner explicitly.
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = journaledRow(fundId, { characterId: holderId });
    const db = reapDb(
      row,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 0, finalized: 0 });
    expect(result.quarantined).toBe(1);
    expect(fundCashNet(db)).toBe(0);
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeUndefined();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();

    // The operator proves the owner stopped and the holder was never paid,
    // then reconciles explicitly: exactly one marker-atomic refund plus a
    // conditional restore, replayable exactly once.
    const quarantinedRow = {
      ...row,
      processingStartedAt: new Date(),
      processingAttempt: {
        from: "queued",
        attemptKey: ATTEMPT,
        quarantined: true,
        outstandingAnchor: 500,
        outstandingUnits: 0,
      },
    };
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(quarantinedRow);
    const outcome = await reconcileQuarantinedRedemption(
      asDb(db),
      fundId,
      row._id,
      "refund-and-restore"
    );
    expect(outcome).toBe("restored");
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![0]).toMatchObject({
      _id: fundId,
      [`redemptionDebitMarkers.${ATTEMPT}`]: { $exists: true },
    });
    expect(fundWrites[0]![1]).toMatchObject({
      $inc: { cashAnchor: 500 },
      $unset: { [`redemptionDebitMarkers.${ATTEMPT}`]: "" },
    });
    expect(fundCashNet(db)).toBe(500);
    const manualRestore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(manualRestore).toBeDefined();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("finalizes a receipted credit without moving money again", async () => {
    const fundId = new ObjectId();
    // Death after the holder credit, before finalize: both legs landed.
    const db = reapDb(
      journaledRow(fundId, {
        paidAmountAnchor: 200,
        processingAttempt: { from: "partial", attemptKey: ATTEMPT },
      }),
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      [{ key: ATTEMPT, amountAnchor: 500, units: 5, remainingUnits: 3, nav: 100 }]
    );

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 0, finalized: 1 });
    // Both money legs already landed: exactly one fund write, the marker
    // cleanup, carrying no $inc...
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![1]).toMatchObject({
      $unset: { [`redemptionDebitMarkers.${ATTEMPT}`]: "" },
    });
    expect(fundWrites[0]![1]).not.toMatchObject({ $inc: { cashAnchor: expect.anything() } });
    expect(fundCashNet(db)).toBe(0);
    // Keep the receipt as the idempotency fence for a stalled owner that
    // resumes after the reaper finalizes this same attempt.
    const holderWrites = db.collectionMocks.characters!.updateOne.mock.calls;
    expect(holderWrites).toHaveLength(0);
    // ...and the bookkeeping completes from the receipt's durable figures.
    const finalize = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "partial"
    );
    expect(finalize).toBeDefined();
    expect(finalize![1]).toMatchObject({
      $set: expect.objectContaining({ paidAmountAnchor: 700, units: 3 }),
    });
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("quarantines an ambiguous row instead of refunding or replaying it", async () => {
    const fundId = new ObjectId();
    // Debit outstanding, but the holder document is gone: the credit may
    // have landed before the holder vanished. Refunding would mint money if
    // it did; restoring would replay a paid entry.
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds", "indexFundTransactions");
    const row = journaledRow(fundId);
    db.collectionMocks[QUEUE]!.find.mockReturnValue(chainableRows([row]) as never);
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(row);
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      makeFund({
        _id: id,
        redemptionDebitMarkers: {
          [ATTEMPT]: {
            amountAnchor: 500,
            units: 0,
            queueEntryId: row._id,
            markedAt: new Date(),
          },
        },
      } as Partial<IndexFund>)
    );
    db.collectionMocks.characters!.find.mockReturnValue(chainableRows([]) as never);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 1, refunded: 0, restored: 0, finalized: 0 });
    expect(result.quarantined).toBe(1);
    // No money moved, no restore, no finalize: the journal stays, flagged.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    const flag = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) =>
        (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
          "processingAttempt.quarantined"
        ] === true
    );
    expect(flag).toBeDefined();
    // The pending debit is stamped on the journal as the explicit
    // reconciliation obligation (500 anchor still outstanding, never
    // silently conserved).
    expect(flag![1]).toMatchObject({
      $set: expect.objectContaining({
        "processingAttempt.quarantined": true,
        "processingAttempt.outstandingAnchor": 500,
        "processingAttempt.outstandingUnits": 0,
      }),
    });
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeUndefined();
  });

  it("never retries a quarantined row", async () => {
    const fundId = new ObjectId();
    const row = journaledRow(fundId, {
      processingAttempt: { from: "queued", attemptKey: ATTEMPT, quarantined: true },
    });
    const db = reapDb(row, { [ATTEMPT]: { amountAnchor: 500, units: 0 } }, null);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 0, quarantined: 1 });
    // Terminal state: no fund read, no money, only the atomic claim write.
    expect(vi.mocked(getFundById)).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks[QUEUE]!.updateOne.mock.calls).toHaveLength(1);
  });

  it("leaves marker-less legacy rows for manual reconciliation", async () => {
    const fundId = new ObjectId();
    const row = makeEntry(fundId, { status: "processing", processingStartedAt: staleAt });
    const db = reapDb(row, {}, null);

    const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

    expect(result).toMatchObject({ reaped: 0, skippedLegacy: 1 });
    // Untouched apart from the atomic claim: no refund, no restore, no pay.
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("concurrent reapers quarantine a stranded debit exactly once", async () => {
    const fundId = new ObjectId();
    const db = reapDb(
      journaledRow(fundId),
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );
    // Only the first reaper wins the atomic claim; the loser skips the row.
    // Neither refunds: the marker is kept, the row quarantines exactly once.
    // Call order: 1 winner claim (won), 2 loser claim (lost, skips), 3
    // winner quarantine (applied, conditional on the attempt it still owns).
    let queueWrites = 0;
    db.collectionMocks[QUEUE]!.updateOne.mockImplementation(async () => {
      queueWrites++;
      if (queueWrites === 1 || queueWrites === 3) return { matchedCount: 1, modifiedCount: 1 };
      return { matchedCount: 0, modifiedCount: 0 };
    });

    const [a, b] = await Promise.all([
      reapStaleRedemptionProcessing(asDb(db), fundId),
      reapStaleRedemptionProcessing(asDb(db), fundId),
    ]);

    expect(a.quarantined + b.quarantined).toBe(1);
    expect(a.reaped + b.reaped).toBe(1);
    expect(a.refunded + b.refunded).toBe(0);
    expect(a.restored + b.restored).toBe(0);
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(fundCashNet(db)).toBe(0);
    const flags = db.collectionMocks[QUEUE]!.updateOne.mock.calls.filter(
      (c) =>
        (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
          "processingAttempt.quarantined"
        ] === true
    );
    expect(flags).toHaveLength(1);
  });

  it("a delayed reaper cannot clobber an owner that finalized in the meantime", async () => {
    // The reaper reads marker-present + receipt-absent, then stalls; the
    // live owner credits and finalizes before the reaper's quarantine write
    // lands. The quarantine is conditional on the row still carrying this
    // attempt, so it matches nothing and the reaper stands down: no flag,
    // no restore, no refund, no finalize, no warning, no money movement.
    const fundId = new ObjectId();
    const row = journaledRow(fundId);
    const db = reapDb(
      row,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    try {
      // Call 1 is the atomic claim (won); every later queue write — the
      // quarantine — matches nothing, because the owner finalized first.
      let queueWrites = 0;
      db.collectionMocks[QUEUE]!.updateOne.mockImplementation(async () => {
        queueWrites++;
        if (queueWrites === 1) return { matchedCount: 1, modifiedCount: 1 };
        return { matchedCount: 0, modifiedCount: 0 };
      });

      const result = await reapStaleRedemptionProcessing(asDb(db), fundId);

      expect(result).toMatchObject({
        reaped: 1,
        refunded: 0,
        restored: 0,
        finalized: 0,
        quarantined: 0,
      });
      // The attempted quarantine carried the attempt-key condition (that is
      // what made it miss instead of clobbering the finalized row)...
      const quarantineAttempt = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
        (c) =>
          (c[1] as { $set?: { "processingAttempt.quarantined"?: boolean } }).$set?.[
            "processingAttempt.quarantined"
          ] === true
      );
      expect(quarantineAttempt).toBeDefined();
      expect(quarantineAttempt![0]).toMatchObject({
        _id: row._id,
        status: "processing",
        "processingAttempt.attemptKey": ATTEMPT,
      });
      // ...and nothing else moved: no restore, no fund or holder writes, no
      // quarantine warning for a row the owner already resolved.
      const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
        (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
      );
      expect(restore).toBeUndefined();
      expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
      expect(fundCashNet(db)).toBe(0);
      expect(warnings.some((w) => /quarantined for manual reconciliation/.test(w))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. Explicit manual reconciliation (`reconcileQuarantinedRedemption`).
//
// The reaper quarantines ambiguous stale rows with the debit marker kept,
// so a truly dead owner strands there until a human resolves it. Each test
// hand-builds a quarantined row plus marker/receipt truth and asserts the
// explicit decision resolves it — or fails closed when the decision
// contradicts truth. Never silently conserved, never an automatic refund.
// ---------------------------------------------------------------------------

describe("reconcileQuarantinedRedemption", () => {
  const ATTEMPT = "rx-dead-attempt-1";

  function quarantinedRow(
    fundId: ObjectId,
    holderId: ObjectId,
    overrides: Record<string, unknown> = {}
  ): IndexFundRedemptionQueueEntry {
    return makeEntry(fundId, {
      characterId: holderId,
      status: "processing",
      processingStartedAt: new Date(),
      processingAttempt: {
        from: "queued",
        attemptKey: ATTEMPT,
        quarantined: true,
        outstandingAnchor: 500,
        outstandingUnits: 0,
        ...overrides,
      },
    }) as IndexFundRedemptionQueueEntry;
  }

  function manualDb(
    row: IndexFundRedemptionQueueEntry,
    fundMarkers: Record<string, object>,
    holderReceipts: object[] | null
  ): MockDb {
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(row);
    vi.mocked(getFundById).mockImplementation(async (_db, id) =>
      makeFund({ _id: id, redemptionDebitMarkers: fundMarkers } as Partial<IndexFund>)
    );
    if (holderReceipts !== null) {
      db.collectionMocks.characters!.find.mockReturnValue(
        chainableRows([
          {
            _id: row.characterId,
            redemptionReceipts: holderReceipts,
          },
        ]) as never
      );
    }
    return db;
  }

  it("refund-and-restore resolves a truly dead owner with no receipt", async () => {
    // Marker present, receipt verifiably absent, owner proven stopped: the
    // operator refunds exactly once (marker-atomic) and restores the row to
    // payable. No holder writes, no audit rows.
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = quarantinedRow(fundId, holderId);
    const db = manualDb(
      row,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );

    const outcome = await reconcileQuarantinedRedemption(
      asDb(db),
      fundId,
      row._id,
      "refund-and-restore"
    );

    expect(outcome).toBe("restored");
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(1);
    expect(fundWrites[0]![0]).toMatchObject({
      _id: fundId,
      [`redemptionDebitMarkers.${ATTEMPT}`]: { $exists: true },
    });
    expect(fundWrites[0]![1]).toMatchObject({
      $inc: { cashAnchor: 500 },
      $unset: { [`redemptionDebitMarkers.${ATTEMPT}`]: "" },
    });
    expect(fundCashNet(db)).toBe(500);
    const restore = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "queued"
    );
    expect(restore).toBeDefined();
    expect(restore![0]).toMatchObject({
      _id: row._id,
      status: "processing",
      "processingAttempt.attemptKey": ATTEMPT,
    });
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("refund-and-restore refuses when the receipt is present (wrong decision cannot double-pay)", async () => {
    // The operator guessed dead-owner, but the holder WAS paid: refunding
    // plus restoring would replay a paid entry. Fail closed instead.
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = quarantinedRow(fundId, holderId);
    const db = manualDb(row, { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } }, [
      { key: ATTEMPT, amountAnchor: 500, units: 5, remainingUnits: 5, nav: 100 },
    ]);

    const outcome = await reconcileQuarantinedRedemption(
      asDb(db),
      fundId,
      row._id,
      "refund-and-restore"
    );

    expect(outcome).toBe("still-quarantined");
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks[QUEUE]!.updateOne).not.toHaveBeenCalled();
    expect(fundCashNet(db)).toBe(0);
  });

  it("finalize-from-receipt completes a paid row without moving money", async () => {
    // The stalled owner did credit before dying: both legs landed, so the
    // operator finalizes the bookkeeping from the receipt's figures and
    // clears the marker. No money moves, no audit rows re-emitted.
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = quarantinedRow(fundId, holderId, { from: "partial" });
    const db = manualDb(
      { ...row, paidAmountAnchor: 200 } as IndexFundRedemptionQueueEntry,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      [{ key: ATTEMPT, amountAnchor: 500, units: 5, remainingUnits: 3, nav: 100 }]
    );

    const outcome = await reconcileQuarantinedRedemption(
      asDb(db),
      fundId,
      row._id,
      "finalize-from-receipt"
    );

    expect(outcome).toBe("finalized");
    expect(fundCashNet(db)).toBe(0);
    expect(holderCashNet(db)).toBe(0);
    const finalize = db.collectionMocks[QUEUE]!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "partial"
    );
    expect(finalize).toBeDefined();
    expect(finalize![1]).toMatchObject({
      $set: expect.objectContaining({ paidAmountAnchor: 700, units: 3 }),
    });
    const markerClear = db.collectionMocks.indexFunds!.updateOne.mock.calls.find((c) =>
      Object.keys((c[1] as { $unset?: Record<string, string> }).$unset ?? {}).some((k) =>
        k.includes(ATTEMPT)
      )
    );
    expect(markerClear).toBeDefined();
    expect(markerClear![1]).not.toMatchObject({ $inc: { cashAnchor: expect.anything() } });
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("finalize-from-receipt refuses when no credit landed", async () => {
    // Finalizing thin air would book a payout nobody received. Fail closed.
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const row = quarantinedRow(fundId, holderId);
    const db = manualDb(
      row,
      { [ATTEMPT]: { amountAnchor: 500, units: 0, markedAt: new Date() } },
      []
    );

    const outcome = await reconcileQuarantinedRedemption(
      asDb(db),
      fundId,
      row._id,
      "finalize-from-receipt"
    );

    expect(outcome).toBe("still-quarantined");
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks[QUEUE]!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves non-quarantined rows alone", async () => {
    const fundId = new ObjectId();
    const db = createMockDb();
    prime(db, QUEUE, "characters", "indexFunds");
    db.collectionMocks[QUEUE]!.findOne.mockResolvedValue(makeEntry(fundId));

    expect(
      await reconcileQuarantinedRedemption(asDb(db), fundId, new ObjectId(), "refund-and-restore")
    ).toBe("not-quarantined");
    expect(
      await reconcileQuarantinedRedemption(
        asDb(db),
        fundId,
        new ObjectId(),
        "finalize-from-receipt"
      )
    ).toBe("not-quarantined");
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks[QUEUE]!.updateOne).not.toHaveBeenCalled();
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

  it("journals the sale before the first leg and clears it at commit", async () => {
    const db = saleDb();

    const res = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);

    expect(res.salesExecuted).toBe(1);
    const fundWrites = db.collectionMocks.indexFunds!.updateOne.mock.calls;
    expect(fundWrites).toHaveLength(3);
    // Journal set (set-if-absent) precedes every value-moving leg...
    expect(fundWrites[0]![0]).toMatchObject({
      pendingLiquiditySale: { $exists: false },
    });
    expect(fundWrites[0]![1]).toMatchObject({
      $set: { pendingLiquiditySale: expect.objectContaining({ shares: 100 }) },
    });
    // ...cash credit lands in the middle...
    expect(fundWrites[1]![1]).toMatchObject({ $inc: { cashAnchor: 5000 } });
    // ...and the journal clears right after the holdings write (commit).
    expect(fundWrites[2]![1]).toMatchObject({ $unset: { pendingLiquiditySale: "" } });
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
    expect(cashWrites).toHaveLength(4);
    expect(cashWrites[0]![1]).toMatchObject({
      $set: { pendingLiquiditySale: expect.objectContaining({ shares: 100 }) },
    });
    expect(cashWrites[1]![1]).toMatchObject({ $inc: { cashAnchor: 5000 } });
    expect(cashWrites[2]![1]).toMatchObject({ $inc: { cashAnchor: -5000 } });
    // Fully unwound: the journal clears, so the next pass raises again.
    expect(cashWrites[3]![1]).toMatchObject({ $unset: { pendingLiquiditySale: "" } });
    expect(fundCashNet(db)).toBe(0);
    expect(db.collectionMocks.indexFundTransactions!.deleteOne).toHaveBeenCalledTimes(0);
  });

  it("compensates without a phantom cash reversal when the fund is gone at cash credit", async () => {
    const db = saleDb();
    db.collectionMocks
      .indexFunds!.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });

    await expect(sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000)).rejects.toThrow(
      "Fund disappeared during redemption-liquidity sale"
    );

    // Shares and issuer legs are restored, but there is no cash leg to reverse.
    expect(vi.mocked(reverseFloatSellDebit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creditSharesToFund)).toHaveBeenCalledTimes(1);
    // Journal set, failed cash credit, journal cleared after the full unwind.
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledTimes(3);
    expect(vi.mocked(updateFundHoldings)).not.toHaveBeenCalled();
  });

  it("quarantines when a raced sale journal appears at start (set-if-absent)", async () => {
    const db = saleDb();
    // Entry check passed on a stale read, but another pass journaled first.
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const res = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);

    expect(res).toMatchObject({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
      liquidityQuarantined: true,
    });
    // The sale never began: no legs, no compensation, journal untouched.
    expect(vi.mocked(settleFloatSellDebit)).not.toHaveBeenCalled();
    expect(vi.mocked(updateFundHoldings)).not.toHaveBeenCalled();
    expect(vi.mocked(reverseFloatSellDebit)).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFunds!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("refuses to raise when a previous sale journal is pending (restart after death)", async () => {
    const db = saleDb();
    const pending = {
      saleId: "ls-dead-sale",
      corporationId: corpId,
      shares: 100,
      proceedsAnchor: 5000,
      startedAt: new Date(),
    };
    db.collectionMocks.indexFunds!.find.mockReturnValue(
      chainableRows([{ _id: saleFund()._id, pendingLiquiditySale: pending }]) as never
    );

    const res = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);

    expect(res.liquidityQuarantined).toBe(true);
    expect(res.cashRaisedAnchor).toBe(0);
    // Fail-closed: no new legs on possibly half-moved books.
    expect(vi.mocked(settleFloatSellDebit)).not.toHaveBeenCalled();
    expect(vi.mocked(updateFundHoldings)).not.toHaveBeenCalled();
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).not.toHaveBeenCalled();
  });

  it("death between commit and journal-clear quarantines the next pass until manual clear", async () => {
    const db = saleDb();
    // The third fund write is the journal clear: kill it, simulating a
    // process death right after the economically complete holdings write.
    let fundWrites = 0;
    db.collectionMocks.indexFunds!.updateOne.mockImplementation(async () => {
      fundWrites++;
      if (fundWrites === 3) throw new Error("process died after commit");
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const first = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);

    // The sale itself is economically complete: shares sold, cash raised, no
    // compensation (there is nothing to reverse).
    expect(first).toMatchObject({ cashRaisedAnchor: 5000, sharesSold: 100, salesExecuted: 1 });
    expect(vi.mocked(reverseFloatSellDebit)).not.toHaveBeenCalled();
    expect(vi.mocked(insertFundTransaction)).toHaveBeenCalledTimes(1);
    // The next pass sees the lingering journal and raises nothing.
    db.collectionMocks.indexFunds!.find.mockReturnValue(
      chainableRows([
        {
          _id: saleFund()._id,
          pendingLiquiditySale: {
            saleId: "ls-lingering",
            corporationId: corpId,
            shares: 100,
            proceedsAnchor: 5000,
            startedAt: new Date(),
          },
        },
      ]) as never
    );
    const second = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);
    expect(second.liquidityQuarantined).toBe(true);
    expect(second.cashRaisedAnchor).toBe(0);
    expect(vi.mocked(settleFloatSellDebit)).toHaveBeenCalledTimes(1);
  });

  it("manual clear resumes raising after reconciliation (quarantine never self-heals)", async () => {
    // Supported-configuration decision (#2223): durable quarantine is sticky
    // and terminal until a human reconciles the journaled sale and clears
    // it. Clearing is conditional and explicit; nothing here self-heals.
    const db = saleDb();
    const pending = {
      saleId: "ls-dead-sale",
      corporationId: corpId,
      shares: 100,
      proceedsAnchor: 5000,
      startedAt: new Date(),
    };
    db.collectionMocks.indexFunds!.find.mockReturnValue(
      chainableRows([{ _id: saleFund()._id, pendingLiquiditySale: pending }]) as never
    );

    const refused = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);
    expect(refused.liquidityQuarantined).toBe(true);
    expect(db.collectionMocks.indexFunds!.updateOne).not.toHaveBeenCalled();

    // Clearing a missing journal reports false and moves nothing.
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    await expect(clearPendingLiquiditySale(asDb(db), saleFund()._id)).resolves.toBe(false);

    // The reconciled clear lands, and the next pass raises again.
    db.collectionMocks.indexFunds!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    });
    await expect(clearPendingLiquiditySale(asDb(db), saleFund()._id)).resolves.toBe(true);
    const clearCall = db.collectionMocks.indexFunds!.updateOne.mock.calls.at(-1)!;
    expect(clearCall[1]).toMatchObject({ $unset: { pendingLiquiditySale: "" } });

    db.collectionMocks.indexFunds!.find.mockReturnValue(chainableRows([]) as never);
    const resumed = await sellFundHoldingShares(asDb(db), saleFund(), corpId, 1000);
    expect(resumed).toMatchObject({ cashRaisedAnchor: 5000, sharesSold: 100, salesExecuted: 1 });
    expect(resumed.liquidityQuarantined).not.toBe(true);
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
