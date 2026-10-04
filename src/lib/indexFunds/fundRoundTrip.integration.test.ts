/**
 * Index-fund subscribe -> rebalance -> redeem round trip (issue #2120).
 *
 * Drives the REAL production flow through `runIndexFundCron`: the NPP investing
 * pass subscribes a fund and (with `nppFundRedemptionEnabled`) queues a bounded
 * autonomous redemption, the next cron turn's Pass 3c pays it through the NPP
 * branch of `processQueuedRedemptions`, and a rebalance sells an overweight
 * holding while placing a residual fund buy bid through the fundBidPolicy path.
 *
 * The Mongo collection layer is a small stateful in-memory fake — the same
 * "mock the collection layer, keep the query helpers real" style the existing
 * fund tests use (`fundCron.test.ts`, `fundCronRedemption.test.ts`), but keeping
 * enough state that the round trip really mutates a fund instead of watching a
 * scripted stub. Every module that reaches outside Mongo (equities, bonds,
 * escrow, ledger, shareholder ops) is mocked at the boundary.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { runIndexFundCron, rebalanceFundToTarget } from "@/lib/indexFunds/fundCron";
import { fundBidLimitPriceLocal } from "@/lib/indexFunds/fundBidPolicy";
import { placeFundShareBuyOrder } from "@/lib/indexFunds/fundShareOrders";
import { sellFundHoldingShares } from "@/lib/indexFunds/fundRedemptionLiquidity";

// ── Module mocks (external I/O boundaries only) ──────────────────────────────

vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(true),
  INDEX_FUNDS_DISABLED_MESSAGE: "disabled",
  INDEX_FUNDS_PARTIAL_MESSAGE: "partial",
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/ledger/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ledger/emit")>()),
  emitLedgerEntries: vi.fn(),
}));
vi.mock("@/lib/ledger/featureFlag", () => ({
  isLedgerShadowEnabledFromConfig: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/financialTxLog/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/financialTxLog/emit")>()),
  emitTx: vi.fn(),
  emitTxBulk: vi.fn(),
  loadTxThresholds: vi
    .fn()
    .mockResolvedValue((await import("@/lib/db/types/financialTxLog")).DEFAULT_TX_THRESHOLDS),
}));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn(async () => false),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(
    async (_withSession: unknown, withoutSession: () => Promise<boolean>) => withoutSession()
  ),
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToFund: vi.fn().mockResolvedValue(true),
  debitSharesFromFund: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  applyFloatBuyCredit: vi.fn(),
  settleFloatSellDebit: vi.fn().mockResolvedValue({ ok: true, split: undefined }),
  reverseFloatSellDebit: vi.fn(),
  onFloatSellCommitted: vi.fn(),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/equities/marketPool", () => ({
  equityPoolCurrency: vi.fn().mockReturnValue("USD"),
  loadEquityPoolsByCurrency: vi.fn().mockResolvedValue(new Map()),
  loadEquityQuote: vi.fn().mockImplementation((_db: unknown, corp: { sharePrice: number }) =>
    Promise.resolve({
      active: false,
      currency: "USD",
      mid: corp.sharePrice,
      bidPriceLocal: corp.sharePrice,
      askPriceLocal: corp.sharePrice,
      bidDepthShares: Number.MAX_SAFE_INTEGER,
      poolCash: 0,
      targetCash: 0,
    })
  ),
}));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn().mockResolvedValue({
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  }),
  sellFundHoldingShares: vi
    .fn()
    .mockResolvedValue({ cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 }),
}));
vi.mock("@/lib/bonds/fundBondHoldings", () => ({
  sumFundBondHoldingsValueAnchor: vi.fn().mockResolvedValue(0),
  sumFundBondHoldingsByFundId: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/bonds/sellFundBondUnits", () => ({
  sellFundBondHoldingsForCash: vi.fn().mockResolvedValue({ proceedsAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/fundBondReserve", () => ({
  deployBondReserveFromCash: vi.fn().mockResolvedValue({ deployedAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/fundCrossRebalancing", () => ({
  executeFundCrossRebalancing: vi.fn(),
  planFundCrossRebalancing: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/fundConstituentLifecycle", () => ({
  findRemovedConstituentHoldings: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/fundHoldingWriteOff", () => ({
  writeOffDeadConstituentHoldings: vi.fn().mockResolvedValue({
    writtenOffCount: 0,
    writtenOffValueAnchor: 0,
    unsellableCount: 0,
  }),
}));
vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  logIndexFundRedeemActivity: vi.fn(),
  resolveIndexFundHolder: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/indexFunds/fundShareOrders", () => ({
  placeFundShareBuyOrder: vi.fn().mockResolvedValue({ ok: true }),
  cancelFundShareOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn().mockReturnValue({}),
  loadCharacterFxRate: vi.fn().mockResolvedValue({ ok: true, rate: 1 }),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  corpLiquidCapitalToAnchor: vi.fn((amount: number) => amount),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  shareTradeAnchorValue: vi.fn(
    (shares: number, corp: { sharePrice: number }) => shares * corp.sharePrice
  ),
}));
vi.mock("@/lib/indexFunds/domesticSovereignCoverage/ensure", () => ({
  domesticCoverageEnabled: vi.fn().mockReturnValue(false),
  ensureDomesticSovereignBondFunds: vi.fn().mockResolvedValue({ ensured: [] }),
}));
vi.mock("@/lib/indexFunds/equityLiquidityFacility", () => ({
  EQUITY_LIQUIDITY_SNAPSHOTS_COLLECTION: "equityLiquidityFacilitySnapshots",
  refreshEquityLiquidityFacility: vi
    .fn()
    .mockResolvedValue({ quotePairsPlaced: 0, bidDepthAnchor: 0, askDepthAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/petitions/service", () => ({
  loadActiveWaiverIds: vi.fn().mockResolvedValue(new Set()),
  resolveDueListingPetitions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/indexFunds/sponsorship/expenseFees", () => ({
  chargeSponsorExpenseFees: vi.fn().mockResolvedValue({ fundsCharged: 0, totalFeeAnchor: 0 }),
}));
vi.mock("@/lib/indexFunds/sponsorship/windUp", () => ({
  advanceWindDowns: vi.fn().mockResolvedValue({ fundsProcessed: 0, fundsCompleted: 0, errors: [] }),
}));

// One shared Mongo adapter exercises protected journal receipts and nested writes.
type Doc = Record<string, any>;
function createStatefulDb(seed: Record<string, Doc[]>) {
  const memory = createInMemoryDb();
  for (const [collection, rows] of Object.entries(seed)) memory.seed(collection, rows);
  return { db: memory as unknown as Db, collection: memory.collection.bind(memory) };
}

const FUND_ID = new ObjectId();
const CORP_ID = new ObjectId();
const NPP_ID = new ObjectId();

const INITIAL_UNIT_SUPPLY = 500_000;
const INITIAL_CASH = 50_000_000;
const INITIAL_NAV = 100;

function seedCorporation(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: CORP_ID,
    name: "Acme Technologies",
    countryId: "US",
    type: "technology",
    sharePrice: 50,
    fundamentalSharePrice: 50,
    totalShares: 100_000,
    publicFloat: 1_000,
    liquidCurrencyCode: "USD",
    liquidCapital: 10_000_000,
    shareholders: [],
    ...overrides,
  };
}

function seedFund(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: FUND_ID,
    slug: "us_top_25",
    name: "US Large-Cap 25 Index",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: INITIAL_NAV,
    unitSupply: INITIAL_UNIT_SUPPLY,
    reserveUnits: 0,
    cashAnchor: INITIAL_CASH,
    targetConstituents: [{ corporationId: CORP_ID, targetWeight: 1, marketCapAnchor: 1_000_000 }],
    holdings: [
      { corporationId: CORP_ID, shares: 1000, avgCostPerShareAnchor: 50, lastValueAnchor: 50_000 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seedNpp(overrides: Record<string, unknown> = {}): Doc {
  return {
    _id: NPP_ID,
    name: "Test NPP",
    countryId: "US",
    // Conservative archetype (score 80): target fund share 0.55.
    favorability: 80,
    politicalInfluence: 80,
    retiredAt: null,
    nppInvestmentCashAnchor: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seedConfig(overrides: Record<string, unknown> = {}): Doc {
  return { _id: "default", indexFundsMode: "full", nppFundRedemptionEnabled: true, ...overrides };
}

function roundTripSeed(config: Doc = seedConfig()) {
  return createStatefulDb({
    gameConfig: [config],
    corporations: [seedCorporation()],
    indexFunds: [seedFund()],
    npps: [seedNpp()],
    indexFundPositions: [],
    indexFundRedemptionQueue: [],
    indexFundTransactions: [],
    indexFundSnapshots: [],
    shareOrders: [],
    exchangeRates: [],
  });
}

function fundDoc(state: ReturnType<typeof createStatefulDb>): Doc {
  return state.collection("indexFunds").docs.find((d) => String(d._id) === FUND_ID.toString())!;
}

describe("index fund subscribe -> redeem round trip via fundCron (#2120)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes via the NPP path and queues a bounded autonomous redemption that debits units and burns supply", async () => {
    const state = roundTripSeed();

    const result = await runIndexFundCron(state.db, { currentTurn: 4 });

    // The NPP subscribed this pass (4 turns' worth of the throttled budget).
    expect(result.nppInvested).toBeGreaterThan(0);

    // Position grew by the subscription, then shrank by the bounded redemption.
    const positions = state.collection("indexFundPositions").docs;
    expect(positions).toHaveLength(1);
    const nppPosition = positions[0]!;
    expect(nppPosition.holderKind).toBe("npp");
    expect(nppPosition.units).toBeGreaterThan(0);

    // One bounded autonomous redemption was queued through enqueueRedemption.
    const queue = await state.db
      .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
      .find({})
      .toArray();
    expect(queue).toHaveLength(1);
    const entry = queue[0]!;
    expect(entry).toMatchObject({
      fundId: FUND_ID,
      holderKind: "npp",
      nppId: NPP_ID,
      unitsBurnedAtRequest: true,
      status: "queued",
    });
    expect(entry.units).toBe(1); // floor(18 units × 10% fraction cap)
    expect(entry.requestedAmountAnchor).toBeCloseTo(entry.units * entry.requestedNavAnchor, 6);

    // Units left the position (18 subscribed − 1 redeemed) and the fund supply
    // was burned by exactly the redeemed units: no phantom units in the NAV
    // denominator and no orphan position.
    expect(nppPosition.units).toBe(18 - entry.units);
    const fund = fundDoc(state);
    expect(fund.unitSupply).toBe(INITIAL_UNIT_SUPPLY + 18 - entry.units);
  });

  it("pays the queued NPP redemption on the next cron turn, NAV-matched, with no orphan holdings", async () => {
    const state = roundTripSeed();

    // Turn 4: subscribe + queue the autonomous redemption.
    await runIndexFundCron(state.db, { currentTurn: 4 });
    const entry = state.collection("indexFundRedemptionQueue").docs[0]!;
    const queuedUnits = entry.units as number;
    const nppCashAfterSubscribe = state.collection("npps").docs[0]!
      .nppInvestmentCashAnchor as number;
    const cashAfterSubscribe = fundDoc(state).cashAnchor as number;
    const supplyAfterSubscribe = fundDoc(state).unitSupply as number;

    // Turn 5: Pass 3c pays the queue through the NPP branch of
    // processQueuedRedemptions.
    const result = await runIndexFundCron(state.db, { currentTurn: 5 });
    expect(result).toMatchObject({ redemptionsPaid: 1, errors: [] });

    const fund = fundDoc(state);
    const npp = state.collection("npps").docs[0]!;
    const paidEntry = state.collection("indexFundRedemptionQueue").docs[0]!;

    // Queue row fully served.
    expect(paidEntry.status).toBe("paid");
    expect(paidEntry.units).toBe(0);

    // Payout is NAV-matched: the redemption transaction records the units paid
    // at the fund's forward NAV, and the NPP wallet moved by exactly that.
    const redeemTx = state
      .collection("indexFundTransactions")
      .docs.find((t) => t.kind === "redemption" && String(t.nppId) === NPP_ID.toString())!;
    expect(redeemTx).toBeDefined();
    expect(redeemTx.units).toBe(queuedUnits);
    const payout = redeemTx.amountAnchor as number;
    expect(payout).toBeCloseTo(queuedUnits * (redeemTx.navAnchor as number), 6);
    expect((npp.nppInvestmentCashAnchor as number) - nppCashAfterSubscribe).toBeCloseTo(payout, 6);

    // Fund cash fell by the payout; supply is unchanged at pay time (the units
    // were burned at request). No orphan: the NPP position still holds units and
    // the queue left nothing unserved.
    expect(cashAfterSubscribe - (fund.cashAnchor as number)).toBeCloseTo(payout, 6);
    expect(fund.unitSupply).toBe(supplyAfterSubscribe);
    expect(state.collection("indexFundPositions").docs.every((p) => (p.units as number) > 0)).toBe(
      true
    );
    expect(state.collection("indexFundPositions").docs).toHaveLength(1);

    // Backing stays consistent with the quoted liability (NAV never collapses).
    const backingRatio = fund.backingRatio as number;
    expect(backingRatio).toBeGreaterThan(0.9);
    expect(backingRatio).toBeLessThan(1.1);
  });

  it("recovers an interrupted payout through the next ordinary cron before NAV pricing", async () => {
    const state = roundTripSeed();
    await runIndexFundCron(state.db, { currentTurn: 4 });
    const before =
      Number(fundDoc(state).cashAnchor) +
      Number(state.collection("npps").docs[0].nppInvestmentCashAnchor);
    const npps = state.collection("npps"),
      update = npps.updateOne.bind(npps);
    let interrupted = false;
    npps.updateOne = async (...args: Parameters<typeof update>) => {
      const result = await update(...args);
      if (
        !interrupted &&
        (args[1] as { $inc?: { nppInvestmentCashAnchor?: number } }).$inc?.nppInvestmentCashAnchor
      ) {
        interrupted = true;
        throw new Error("Synthetic ordinary-turn payout acknowledgement lost");
      }
      return result;
    };
    const failed = await runIndexFundCron(state.db, { currentTurn: 5 });
    expect(interrupted).toBe(true);
    expect(failed.errors).toHaveLength(1);
    const recovered = await runIndexFundCron(state.db, { currentTurn: 6 });
    expect(recovered.errors).toEqual([]);
    expect(recovered.redemptionsPaid).toBe(1);
    expect(state.collection("indexFundRedemptionQueue").docs[0]).toMatchObject({
      status: "paid",
      units: 0,
    });
    expect(
      Number(fundDoc(state).cashAnchor) +
        Number(state.collection("npps").docs[0].nppInvestmentCashAnchor)
    ).toBeCloseTo(before, 6);
    expect(
      state.collection("indexFundTransactions").docs.filter((row) => row.kind === "redemption")
    ).toHaveLength(1);
    await runIndexFundCron(state.db, { currentTurn: 7 });
    expect(
      state.collection("indexFundTransactions").docs.filter((row) => row.kind === "redemption")
    ).toHaveLength(1);
  });

  it("is a no-op round trip when nppFundRedemptionEnabled is off (no queue rows)", async () => {
    const state = roundTripSeed(seedConfig({ nppFundRedemptionEnabled: false }));

    await runIndexFundCron(state.db, { currentTurn: 4 });
    await runIndexFundCron(state.db, { currentTurn: 5 });

    // Subscriptions still happen (NPP investing is unrelated to the flag) but
    // nothing is ever queued for autonomous redemption.
    expect(state.collection("npps").docs[0]!.nppInvestmentCashAnchor).not.toBe(0);
    expect(state.collection("indexFundRedemptionQueue").docs).toHaveLength(0);
  });

  it("reaches the fund buy-bid path (fundBidPolicy → placeFundShareBuyOrder) from the rebalance sell flow", async () => {
    const overweightId = new ObjectId();
    const underweightId = new ObjectId();
    const bidFund = seedFund({
      _id: new ObjectId(),
      cashAnchor: 500_000,
      targetConstituents: [
        { corporationId: underweightId, targetWeight: 0.5, marketCapAnchor: 1_000_000 },
      ],
      holdings: [
        {
          corporationId: overweightId,
          shares: 5000,
          avgCostPerShareAnchor: 10,
          lastValueAnchor: 50_000,
        },
      ],
    });
    const state = createStatefulDb({
      indexFunds: [bidFund],
      shareOrders: [],
      indexFundTransactions: [],
      indexFundSnapshots: [],
      corporations: [
        seedCorporation({ _id: overweightId, sharePrice: 10, fundamentalSharePrice: 10 }),
        // No float on the underweight corp, so the residual deficit becomes a
        // standing limit bid rather than an immediate float buy.
        seedCorporation({
          _id: underweightId,
          sharePrice: 10,
          fundamentalSharePrice: 10,
          publicFloat: 0,
        }),
      ],
    });

    vi.mocked(sellFundHoldingShares).mockResolvedValueOnce({
      cashRaisedAnchor: 10_000,
      sharesSold: 1000,
      salesExecuted: 1,
    });

    const result = await rebalanceFundToTarget(
      state.db,
      bidFund as never,
      state.collection("corporations").docs as never,
      {},
      new Map(),
      24
    );

    // Sell leg fired (overweight trimmed) …
    expect(result.sells).toBe(1);
    expect(sellFundHoldingShares).toHaveBeenCalledTimes(1);

    // … and the same rebalance reachably places a fund buy bid priced by the
    // shared fundBidPolicy helper.
    expect(placeFundShareBuyOrder).toHaveBeenCalledTimes(1);
    const bidInput = vi.mocked(placeFundShareBuyOrder).mock.calls[0]![1];
    expect(bidInput.shares).toBe(1000);
    expect(bidInput.limitPriceLocal).toBeCloseTo(fundBidLimitPriceLocal(10), 6);
  });
});
