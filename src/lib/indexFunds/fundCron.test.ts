import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recomputeNav,
  shouldRebalanceIndexFundConstituents,
  shouldRunCrossFundRebalancing,
  executeFundShareBuy,
  rebalanceFundToTarget,
  rebalanceConstituents,
  processQueuedRedemptions,
} from "./fundCron";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { INDEX_FUND_INITIAL_NAV } from "@/lib/indexFunds/unitAccounting";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

// ---------------------------------------------------------------------------
// Mocks for executeFundShareBuy (avoids a live MongoDB dependency)
// ---------------------------------------------------------------------------

// We mock all DB-touching helpers that executeFundShareBuy delegates to.
// Each mock is set up per-test in beforeEach so state doesn't leak.

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  updateFundHoldings: vi.fn().mockResolvedValue(undefined),
  insertFundTransaction: vi.fn().mockResolvedValue(undefined),
  insertFundTransactionsBulk: vi.fn().mockResolvedValue(undefined),
  // other exports used by the file but not by executeFundShareBuy
  getFundById: vi.fn(),
  listActiveFunds: vi.fn(),
  listServiceableFunds: vi.fn(),
  updateFundNav: vi.fn(),
  updateFundConstituents: vi.fn(),
  setFundStatus: vi.fn(),
  listPendingRedemptions: vi.fn().mockResolvedValue([]),
  updateRedemptionEntry: vi.fn(),
  insertFundSnapshot: vi.fn(),
  FUND_REDEMPTION_QUEUE_COLLECTION: "indexFundRedemptionQueue",
}));

const { applyBuyMock } = vi.hoisted(() => ({ applyBuyMock: vi.fn() }));

vi.mock("@/lib/indexFunds/fundShareBuySpend", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, applyFundShareBuySpend: applyBuyMock };
});

vi.mock("@/lib/equities/marketPool", () => ({
  loadEquityPoolsByCurrency: vi.fn().mockResolvedValue(new Map()),
  equityPoolCurrency: vi
    .fn()
    .mockImplementation(
      (corp: { liquidCurrencyCode?: string | null }) => corp.liquidCurrencyCode ?? "USD"
    ),
  readEquityPool: vi.fn().mockResolvedValue(null),
  loadEquityQuote: vi.fn().mockImplementation((_db, corp: { sharePrice: number }) =>
    Promise.resolve({
      active: false,
      currency: "USD",
      midPriceLocal: corp.sharePrice,
      bidPriceLocal: corp.sharePrice,
      askPriceLocal: corp.sharePrice,
      bidDepthShares: Number.MAX_SAFE_INTEGER,
      poolCash: 0,
      targetCash: 0,
    })
  ),
}));

vi.mock("@/lib/corporations/shareBuybackMode", () => ({
  getShareBuybackMode: vi.fn().mockReturnValue("instant"),
}));

vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/corporations/marketExecution", () => ({
  isOrderFlowPriceEligible: vi.fn().mockReturnValue(false),
  resolveShareExecutionPrice: vi
    .fn()
    .mockImplementation((corp: { sharePrice: number }) => corp.sharePrice),
}));

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(
      async (
        withSession: (s: undefined) => Promise<unknown>,
        withoutSession: () => Promise<unknown>
      ) => {
        // In test: simulate standalone mode (no transactions), call withoutSession
        return withoutSession();
      }
    ),
}));

// Stubs for other modules imported at the top of fundCron.ts (not needed by executeFundShareBuy)
vi.mock("@/lib/indexFunds/fundConstituentLifecycle", () => ({
  findRemovedConstituentHoldings: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn().mockResolvedValue(false),
  INDEX_FUNDS_DISABLED_MESSAGE: "disabled",
}));
vi.mock("@/lib/indexFunds/fundBondReserve", () => ({ deployBondReserveFromCash: vi.fn() }));
vi.mock("@/lib/indexFunds/fundCrossRebalancing", () => ({
  executeFundCrossRebalancing: vi.fn(),
  planFundCrossRebalancing: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/indexFunds/nppInvesting", () => ({ processNPPFundInvestments: vi.fn() }));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn(),
  sellFundHoldingShares: vi
    .fn()
    .mockResolvedValue({ cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 }),
}));
vi.mock("@/lib/bonds/fundBondHoldings", () => ({
  sumFundBondHoldingsValueAnchor: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/characterFunds", () => ({ buildPersonalBalanceInc: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  // A4: the bid loop reads the rate table it already loaded instead of a
  // findOne per bid, so the batch form is what the cron imports now.
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  corpLiquidCapitalToAnchor: vi.fn().mockImplementation((amount: number) => amount),
}));

vi.mock("@/lib/indexFunds/fundShareOrders", () => ({
  placeFundShareBuyOrder: vi.fn().mockResolvedValue({ ok: true }),
  cancelFundShareOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/indexFunds/fundBidPolicy", () => ({
  fundBidLimitPriceLocal: vi.fn().mockImplementation((price: number) => price * 1.02),
  INDEX_FUND_BID_MAX_OPEN_TURNS: 24,
}));
vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  resolveIndexFundHolder: vi.fn(),
}));
vi.mock("@/lib/indexFunds/fundFloatAbsorptionPlan", () => ({
  planFloatAbsorptionAcrossFunds: vi.fn().mockReturnValue([]),
}));

// We only test the pure function recomputeNav here since the full cron
// requires a MongoDB instance. The integration test would need a real DB.

describe("fundCron — shouldRebalanceIndexFundConstituents", () => {
  it("rebalances on first init when target constituents are empty", () => {
    expect(shouldRebalanceIndexFundConstituents(1, 0)).toBe(true);
    expect(shouldRebalanceIndexFundConstituents(0, 0)).toBe(true);
  });

  it("rebalances populated baskets only on financial-day boundaries", () => {
    expect(shouldRebalanceIndexFundConstituents(1, 10)).toBe(false);
    expect(shouldRebalanceIndexFundConstituents(TURNS_PER_DAY - 1, 10)).toBe(false);
    expect(shouldRebalanceIndexFundConstituents(TURNS_PER_DAY, 10)).toBe(true);
    expect(shouldRebalanceIndexFundConstituents(TURNS_PER_DAY * 2, 10)).toBe(true);
    // Turn 0 with a populated basket is the one non-rebalancing case.
    expect(shouldRebalanceIndexFundConstituents(0, 10)).toBe(false);
  });
});

describe("fundCron — shouldRunCrossFundRebalancing", () => {
  it("runs only on financial-day boundaries (matching the rebalance cadence)", () => {
    expect(shouldRunCrossFundRebalancing(0)).toBe(false);
    expect(shouldRunCrossFundRebalancing(1)).toBe(false);
    expect(shouldRunCrossFundRebalancing(TURNS_PER_DAY - 1)).toBe(false);
    expect(shouldRunCrossFundRebalancing(TURNS_PER_DAY)).toBe(true);
    expect(shouldRunCrossFundRebalancing(TURNS_PER_DAY * 3)).toBe(true);
  });
});

describe("fundCron: queued redemption claims", () => {
  it("does not debit or pay when another worker owns the queue row", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const queueEntry: IndexFundRedemptionQueueEntry = {
      _id: new ObjectId(),
      fundId,
      holderKind: "character",
      characterId: new ObjectId(),
      units: 10,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 1_000,
      paidAmountAnchor: 0,
      status: "queued",
      unitsBurnedAtRequest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fund: IndexFund = {
      _id: fundId,
      slug: "claim-test",
      name: "Claim Test Fund",
      tickerSymbol: "CTF",
      scope: "country",
      kind: "broad",
      countryId: "US",
      anchorCurrencyCode: "USD",
      status: "active",
      quotedNav: 100,
      unitSupply: 10,
      reserveUnits: 0,
      cashAnchor: 1_000,
      targetConstituents: [],
      holdings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { listPendingRedemptions } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(listPendingRedemptions).mockResolvedValueOnce([queueEntry]);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValueOnce(null);

    await expect(processQueuedRedemptions(db as never, fund, false, 1)).resolves.toBe(0);
    expect(db.collectionMocks.indexFunds).toBeUndefined();
    expect(db.collectionMocks.characters).toBeUndefined();
  });
});

describe("fundCron — recomputeNav", () => {
  const baseFund: IndexFund = {
    _id: new ObjectId(),
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 500_000,
    reserveUnits: 500_000,
    cashAnchor: 50_000_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns initial NAV when unit supply is zero", () => {
    const fund = { ...baseFund, unitSupply: 0, cashAnchor: 0, holdings: [] };
    const nav = recomputeNav(fund);
    expect(nav).toBe(INDEX_FUND_INITIAL_NAV);
  });

  it("computes NAV from cash + holdings value divided by unit supply", () => {
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: 30_000_000,
      holdings: [
        {
          corporationId: new ObjectId(),
          shares: 1000,
          avgCostPerShareAnchor: 50,
          lastValueAnchor: 50_000,
        },
      ],
      unitSupply: 500_000,
    };
    const nav = recomputeNav(fund);
    // NAV = (30M cash + 50K holdings) / 500K units = 60.1
    expect(nav).toBeCloseTo(60.1, 1);
  });

  it("includes bond principal in NAV backing", () => {
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: 10_000_000,
      bondAllocations: [{ countryId: "US", principalAnchor: 5_000_000, couponRate: 4 }],
      holdings: [],
      unitSupply: 100_000,
    };
    const nav = recomputeNav(fund, { bondPrincipalAnchor: 5_000_000 });
    expect(nav).toBeCloseTo(150, 0);
  });

  it("falls back to avgCostPerShareAnchor when lastValueAnchor is absent", () => {
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: 10_000_000,
      holdings: [
        {
          corporationId: new ObjectId(),
          shares: 2000,
          avgCostPerShareAnchor: 100,
        },
      ],
      unitSupply: 100_000,
    };
    const nav = recomputeNav(fund);
    // NAV = (10M cash + 200K holdings) / 100K units = 102
    expect(nav).toBeCloseTo(102, 0);
  });

  it("returns null for negative NAV", () => {
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: -1000,
      holdings: [],
      unitSupply: 500_000,
    };
    const nav = recomputeNav(fund);
    expect(nav).toBeNull();
  });

  it("includes open order escrow in NAV backing", () => {
    // Fund placed limit buy bids: cashAnchor was debited by escrow, but those
    // orders represent committed value and must be counted so NAV is not understated.
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: 8_000_000, // 2M locked in open bid escrow
      holdings: [],
      unitSupply: 100_000,
    };
    const navWithoutEscrow = recomputeNav(fund);
    const navWithEscrow = recomputeNav(fund, { openOrdersEscrowAnchor: 2_000_000 });
    // Without: 8M / 100K = 80
    expect(navWithoutEscrow).toBeCloseTo(80, 0);
    // With: (8M + 2M) / 100K = 100
    expect(navWithEscrow).toBeCloseTo(100, 0);
  });

  it("counts queued redemption units as outstanding rather than as a payable", () => {
    const fund: IndexFund = {
      ...baseFund,
      cashAnchor: 10_000_000,
      holdings: [],
      unitSupply: 90_000,
    };
    // 10M over 90K held + 10K queued = 100. A queued holder is still a holder.
    const nav = recomputeNav(fund, { queuedRedemptionUnits: 10_000 });
    expect(nav).toBeCloseTo(100, 0);
  });

  it("does not let a queued claim push NAV down as assets fall", () => {
    // The GLB50 failure: a large redemption is queued, then the book halves.
    // Under the old fixed-cash-liability model the remaining holders absorbed
    // the entire decline and NAV collapsed to zero. Pro-rata, everyone takes
    // the same proportional hit and NAV stays positive and honest.
    const before = recomputeNav(
      { ...baseFund, cashAnchor: 10_000_000, holdings: [], unitSupply: 50_000 },
      { queuedRedemptionUnits: 50_000 }
    );
    const after = recomputeNav(
      { ...baseFund, cashAnchor: 5_000_000, holdings: [], unitSupply: 50_000 },
      { queuedRedemptionUnits: 50_000 }
    );
    expect(before).toBeCloseTo(100, 0);
    expect(after).toBeCloseTo(50, 0);
  });
});

// ---------------------------------------------------------------------------
// executeFundShareBuy — buy regression test
// ---------------------------------------------------------------------------

describe("fundCron — executeFundShareBuy caller boundary", () => {
  const fundId = new ObjectId();
  const corpId = new ObjectId();

  const baseFund: IndexFund = {
    _id: fundId,
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 500_000,
    reserveUnits: 500_000,
    cashAnchor: 10_000,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // EligibleCorpRow shape (subset used by executeFundShareBuy)
  const baseCorp = {
    _id: corpId,
    countryId: "US" as const,
    type: "tech" as const,
    secondaryType: undefined,
    sharePrice: 50,
    fundamentalSharePrice: 50,
    totalShares: 100_000,
    liquidCurrencyCode: "USD" as const,
    publicFloat: 500,
    shareBuybackMode: undefined,
  };

  // The shell delegates every balance write to the keyed primitive; the db
  // handle passes straight through to the mocked quote/pool helpers.
  const stubDb = { collection: vi.fn() } as unknown as import("mongodb").Db;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pins quote-derived amounts under a deterministic key and reports the stored outcome", async () => {
    const { buildFundShareBuyKey } = await import("@/lib/indexFunds/fundShareBuySpend");
    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    applyBuyMock.mockResolvedValue({
      duplicate: false,
      outcome: { sharesBought: 10, anchorSpent: 500 },
    });

    const result = await executeFundShareBuy(
      stubDb,
      baseFund,
      baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
      10,
      /* referencePriceAnchor */ 50,
      /* currentTurn */ 5
    );

    expect(result).toEqual({ ok: true, sharesBought: 10, anchorSpent: 500 });
    // Mock quote carries no mid, so the anchor reference passes through
    // untouched and the cost is shares x reference.
    expect(applyBuyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fundId,
        corpId,
        shares: 10,
        executionPriceLocal: baseCorp.sharePrice,
        executionPriceAnchor: 50,
        actualCost: 500,
        issuerCreditLocal: 500,
        orderFlowEligible: false,
        currency: "USD",
        issuerRoute: "liquid",
        turn: 5,
        idempotencyKey: buildFundShareBuyKey(fundId, corpId, 5, 10),
      })
    );
    expect(recordShareTrade).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "market_buy", turn: 5, shares: 10 })
    );
  });

  it("applies the market-maker spread onto the caller FX reference", async () => {
    const { loadEquityQuote } = await import("@/lib/equities/marketPool");
    vi.mocked(loadEquityQuote).mockResolvedValueOnce({
      active: true,
      currency: "USD",
      mid: 50,
      askPriceLocal: 55,
    } as never);
    applyBuyMock.mockResolvedValue({
      duplicate: false,
      outcome: { sharesBought: 10, anchorSpent: 550 },
    });

    const result = await executeFundShareBuy(
      stubDb,
      baseFund,
      baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
      10,
      50,
      5
    );

    expect(result.sharesBought).toBe(10);
    expect(result.anchorSpent).toBeCloseTo(550, 10);
    expect(result.ok).toBe(true);
    const spreadInput = vi.mocked(applyBuyMock).mock.calls[0]![1] as Record<string, number>;
    expect(spreadInput.executionPriceLocal).toBe(55);
    // 50 * (55 / 50) in floating point: the pinned cost carries the dust,
    // exactly like the legacy N x priceAnchor debit did.
    expect(spreadInput.executionPriceAnchor).toBeCloseTo(55, 10);
    expect(spreadInput.actualCost).toBeCloseTo(550, 10);
    expect(spreadInput.issuerCreditLocal).toBe(55 * 10);
  });

  it("maps a lost cash or float race onto ok:false", async () => {
    const { FUND_SHARE_BUY_FUNDS, FUND_SHARE_BUY_CORP } =
      await import("@/lib/indexFunds/fundShareBuySpend");
    for (const sentinel of [FUND_SHARE_BUY_FUNDS, FUND_SHARE_BUY_CORP]) {
      applyBuyMock.mockRejectedValueOnce(new Error(`${sentinel}:guard-rejected`));
      const result = await executeFundShareBuy(
        stubDb,
        baseFund,
        baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
        10,
        50,
        5
      );
      expect(result).toEqual({ ok: false, sharesBought: 0, anchorSpent: 0 });
    }
  });

  it("returns ok:false without calling the primitive for non-positive shares", async () => {
    for (const shares of [0, -10, 2.5]) {
      const result = await executeFundShareBuy(
        stubDb,
        baseFund,
        baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
        shares,
        50,
        5
      );
      expect(result).toEqual({ ok: false, sharesBought: 0, anchorSpent: 0 });
    }
    expect(applyBuyMock).not.toHaveBeenCalled();
  });

  it("skips the trade log on a same-key replay", async () => {
    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    applyBuyMock.mockResolvedValue({
      duplicate: true,
      outcome: { sharesBought: 10, anchorSpent: 500 },
    });

    const result = await executeFundShareBuy(
      stubDb,
      baseFund,
      baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
      10,
      50,
      5
    );

    expect(result).toEqual({ ok: true, sharesBought: 10, anchorSpent: 500 });
    expect(recordShareTrade).not.toHaveBeenCalled();
  });

  it("propagates key conflicts and terminal states instead of masking them", async () => {
    const { MoneyFlowKeyConflictError, MoneyFlowTerminalError } =
      await import("@/lib/db/nonAtomicMoneyFlow");
    applyBuyMock.mockRejectedValueOnce(new MoneyFlowKeyConflictError("k"));
    await expect(
      executeFundShareBuy(
        stubDb,
        baseFund,
        baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
        10,
        50,
        5
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    applyBuyMock.mockRejectedValueOnce(new MoneyFlowTerminalError("k", "failed"));
    await expect(
      executeFundShareBuy(
        stubDb,
        baseFund,
        baseCorp as unknown as Parameters<typeof executeFundShareBuy>[2],
        10,
        50,
        5
      )
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });
});

// ---------------------------------------------------------------------------
// rebalanceFundToTarget tests
// ---------------------------------------------------------------------------

describe("fundCron — rebalanceFundToTarget", () => {
  const fundId = new ObjectId();
  const overweightCorpId = new ObjectId();
  const underweightCorpId = new ObjectId();

  // A fund that holds too much of overweightCorp and not enough of underweightCorp
  const fundWithDrift: IndexFund = {
    _id: fundId,
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 500_000,
    reserveUnits: 500_000,
    // Enough cash to buy underweight shares
    cashAnchor: 100_000,
    targetConstituents: [
      // target = 10% of (75% × total) each
      { corporationId: overweightCorpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
      { corporationId: underweightCorpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
    ],
    // currently holds 5× the target of overweightCorp; zero of underweightCorp
    holdings: [
      {
        corporationId: overweightCorpId,
        shares: 5000, // overweight
        avgCostPerShareAnchor: 10,
        lastValueAnchor: 50_000,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const candidateCorps = [
    {
      _id: overweightCorpId,
      countryId: "US" as const,
      type: "tech" as const,
      secondaryType: undefined,
      sharePrice: 10,
      fundamentalSharePrice: 10,
      totalShares: 100_000,
      liquidCurrencyCode: "USD" as const,
      publicFloat: 0, // no float for overweight (sells go back to float)
      shareBuybackMode: undefined,
    },
    {
      _id: underweightCorpId,
      countryId: "US" as const,
      type: "tech" as const,
      secondaryType: undefined,
      sharePrice: 10,
      fundamentalSharePrice: 10,
      totalShares: 100_000,
      liquidCurrencyCode: "USD" as const,
      publicFloat: 5000, // has float to absorb
      shareBuybackMode: undefined,
    },
  ];

  function buildRebalanceMockDb() {
    const indexFundsColl = {
      findOneAndUpdate: vi
        .fn()
        .mockImplementation(
          (
            filter: { cashAnchor?: { $gte: number } },
            update: { $inc?: { cashAnchor?: number } }
          ) => {
            // Simulate successful debit
            const cashAnchor = (fundWithDrift.cashAnchor ?? 0) + (update.$inc?.cashAnchor ?? 0);
            return Promise.resolve({ _id: fundId, cashAnchor, holdings: fundWithDrift.holdings });
          }
        ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    return {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "indexFunds") return indexFundsColl;
        if (name === "indexFundTransactions") return { insertOne: vi.fn().mockResolvedValue({}) };
        // shareOrders: return empty list for open bids so bid logic is a no-op in existing tests
        if (name === "shareOrders")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        return { findOneAndUpdate: vi.fn(), updateOne: vi.fn(), insertOne: vi.fn() };
      }),
      _indexFundsColl: indexFundsColl,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sellFundHoldingShares for overweight holdings and executeFundShareBuy for underweight", async () => {
    const mockDb = buildRebalanceMockDb();

    // getFundById returns the drift fund so re-fetches work
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(fundWithDrift);

    applyBuyMock.mockResolvedValue({
      duplicate: false,
      outcome: { sharesBought: 20, anchorSpent: 200 },
    });

    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 100,
      sharesSold: 10,
      salesExecuted: 1,
    });

    const result = await rebalanceFundToTarget(
      mockDb as unknown as import("mongodb").Db,
      fundWithDrift,
      candidateCorps as unknown as Parameters<typeof rebalanceFundToTarget>[2],
      {},
      new Map(),
      5
    );

    // Should have sold overweight and bought underweight
    expect(result.sells).toBeGreaterThanOrEqual(1);
    // sellFundHoldingShares called for overweight corp
    expect(sellFundHoldingShares).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      overweightCorpId,
      expect.any(Number),
      expect.objectContaining({ note: expect.stringContaining("Rebalance") })
    );
    // Buys run through the keyed primitive under a deterministic per-leg key.
    expect(applyBuyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fundId,
        turn: 5,
        idempotencyKey: expect.stringContaining("fund-share-buy"),
      })
    );
    expect(result.buys).toBeGreaterThanOrEqual(1);
  });

  it("returns { buys, sells } counts", async () => {
    const mockDb = buildRebalanceMockDb();
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(fundWithDrift);

    applyBuyMock.mockResolvedValue({
      duplicate: false,
      outcome: { sharesBought: 20, anchorSpent: 200 },
    });

    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 200,
      sharesSold: 20,
      salesExecuted: 1,
    });

    const result = await rebalanceFundToTarget(
      mockDb as unknown as import("mongodb").Db,
      fundWithDrift,
      candidateCorps as unknown as Parameters<typeof rebalanceFundToTarget>[2],
      {},
      new Map(),
      5
    );

    expect(typeof result.sells).toBe("number");
    expect(typeof result.buys).toBe("number");
  });

  it("skips a buy leg whose key settled without breaking the pass", async () => {
    const mockDb = buildRebalanceMockDb();
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(fundWithDrift);

    const { MoneyFlowKeyConflictError } = await import("@/lib/db/nonAtomicMoneyFlow");
    applyBuyMock.mockRejectedValue(new MoneyFlowKeyConflictError("stale-key"));

    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 200,
      sharesSold: 20,
      salesExecuted: 1,
    });

    const result = await rebalanceFundToTarget(
      mockDb as unknown as import("mongodb").Db,
      fundWithDrift,
      candidateCorps as unknown as Parameters<typeof rebalanceFundToTarget>[2],
      {},
      new Map(),
      5
    );

    expect(result.buys).toBe(0);
    expect(result.sells).toBeGreaterThanOrEqual(1);
  });
});

describe("fundCron — rebalanceConstituents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays active (does not pause) when a constituent is delisted or made private", async () => {
    const delistedCorpId = new ObjectId();

    const fund: IndexFund = {
      _id: new ObjectId(),
      slug: "no-such-fund-slug",
      name: "Test Fund",
      status: "active",
      scope: "global",
      kind: "equity",
      anchorCurrencyCode: "USD",
      cashAnchor: 1000,
      quotedNav: 10,
      unitSupply: 100,
      targetConstituents: [],
      holdings: [
        {
          corporationId: delistedCorpId,
          shares: 100,
          avgCostPerShareAnchor: 5,
          lastValueAnchor: 500,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IndexFund;

    // Simulate: the delisted corp's holding is returned as removed
    const { findRemovedConstituentHoldings } =
      await import("@/lib/indexFunds/fundConstituentLifecycle");
    vi.mocked(findRemovedConstituentHoldings).mockReturnValue([
      {
        corporationId: delistedCorpId,
        shares: 100,
        avgCostPerShareAnchor: 5,
        lastValueAnchor: 500,
      },
    ]);

    // After selling, getFundById returns the fund without the delisted holding
    const { getFundById, setFundStatus } = await import("@/lib/indexFunds/fundQueries");
    const fundAfterSale: IndexFund = { ...fund, holdings: [] } as unknown as IndexFund;
    vi.mocked(getFundById).mockResolvedValue(fundAfterSale);

    const { sellFundHoldingsForRedemptionCash } =
      await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingsForRedemptionCash).mockResolvedValue({
      cashRaisedAnchor: 500,
      sharesSold: 100,
      salesExecuted: 1,
    });

    const mockDb = {} as unknown as import("mongodb").Db;

    // Pass an empty corps array — the delisted corp is absent from candidates,
    // which is why findRemovedConstituentHoldings returns it as removed.
    await rebalanceConstituents(mockDb, fund, [], {}, 1);

    // The sale should have happened
    expect(sellFundHoldingsForRedemptionCash).toHaveBeenCalledOnce();

    // The fund must NOT have been paused — setFundStatus should not be called
    // with "paused" / "constituent_delisted"
    const pauseCalls = vi
      .mocked(setFundStatus)
      .mock.calls.filter((args) => args[2] === "paused" && args[3] === "constituent_delisted");
    expect(pauseCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// rebalanceFundToTarget — bid placement / cancellation tests (Task 8)
// ---------------------------------------------------------------------------

describe("fundCron — rebalanceFundToTarget bid logic", () => {
  const fundId = new ObjectId();
  const inBasketCorpId = new ObjectId();
  const offBasketCorpId = new ObjectId();

  // A base fund whose single constituent has NO public float so it gets a bid leg.
  const baseFund: IndexFund = {
    _id: fundId,
    slug: "us_top_25",
    name: "US Top 25",
    tickerSymbol: "US25",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 500_000,
    reserveUnits: 500_000,
    cashAnchor: 500_000,
    targetConstituents: [
      { corporationId: inBasketCorpId, targetWeight: 0.1, marketCapAnchor: 1_000_000 },
    ],
    holdings: [], // zero holdings → underweight
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Corp with NO float (forces residual bid leg instead of immediate float buy).
  const inBasketCorp = {
    _id: inBasketCorpId,
    countryId: "US" as const,
    type: "tech" as const,
    secondaryType: undefined,
    sharePrice: 100,
    fundamentalSharePrice: 100,
    totalShares: 10_000,
    liquidCurrencyCode: "USD" as const,
    publicFloat: 0,
    shareBuybackMode: undefined,
  };

  type DbArg = import("mongodb").Db;

  function buildBidMockDb(openOrders: import("mongodb").WithId<import("mongodb").Document>[] = []) {
    let openOrdersList = [...openOrders];
    const shareOrdersColl = {
      find: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockImplementation(() => Promise.resolve([...openOrdersList])),
      })),
    };
    const indexFundsColl = {
      findOneAndUpdate: vi
        .fn()
        .mockImplementation((_filter: unknown, update: { $inc?: { cashAnchor?: number } }) => {
          const cashAnchor = baseFund.cashAnchor + (update.$inc?.cashAnchor ?? 0);
          return Promise.resolve({ _id: fundId, cashAnchor, holdings: [] });
        }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    return {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "indexFunds") return indexFundsColl;
        if (name === "shareOrders") return shareOrdersColl;
        if (name === "indexFundTransactions") return { insertOne: vi.fn().mockResolvedValue({}) };
        return { findOneAndUpdate: vi.fn(), updateOne: vi.fn(), insertOne: vi.fn() };
      }),
      _shareOrdersColl: shareOrdersColl,
      _setOpenOrders: (orders: import("mongodb").WithId<import("mongodb").Document>[]) => {
        openOrdersList = [...orders];
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("places exactly one bid for underweight constituent with zero float", async () => {
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(baseFund);

    const { placeFundShareBuyOrder } = await import("@/lib/indexFunds/fundShareOrders");
    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });

    const mockDb = buildBidMockDb([]);

    const result = await rebalanceFundToTarget(
      mockDb as unknown as DbArg,
      baseFund,
      [inBasketCorp as unknown as Parameters<typeof rebalanceFundToTarget>[2][number]],
      {},
      new Map(),
      5
    );

    expect(result.bidsPlaced).toBe(1);
    expect(placeFundShareBuyOrder).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(placeFundShareBuyOrder).mock.calls[0]![1];
    expect(callArgs.limitPriceLocal).toBeCloseTo(inBasketCorp.sharePrice * 1.02, 2);
  });

  it("does not place a duplicate bid when an open bid already exists for that (fund, corp)", async () => {
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(baseFund);

    const { placeFundShareBuyOrder } = await import("@/lib/indexFunds/fundShareOrders");
    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });

    // Pre-existing open bid for the in-basket corp.
    const existingBid = {
      _id: new ObjectId(),
      corporationId: inBasketCorpId,
      placerFundId: fundId,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 102,
      escrowAmount: 1020,
      escrowAnchor: 1020,
      updatedAt: new Date(),
    };

    const mockDb = buildBidMockDb([
      existingBid as unknown as import("mongodb").WithId<import("mongodb").Document>,
    ]);

    await rebalanceFundToTarget(
      mockDb as unknown as DbArg,
      baseFund,
      [inBasketCorp as unknown as Parameters<typeof rebalanceFundToTarget>[2][number]],
      {},
      new Map(),
      5
    );

    // Should NOT have placed a second bid.
    expect(placeFundShareBuyOrder).not.toHaveBeenCalled();
  });

  it("cancels off-basket open bids but keeps open bids for in-basket float-covered corps (regression for Finding 1)", async () => {
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(baseFund);

    const { cancelFundShareOrder } = await import("@/lib/indexFunds/fundShareOrders");
    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });

    const offBasketBidId = new ObjectId();
    const inBasketBidId = new ObjectId();

    // off-basket bid: corp not in targetConstituents
    const offBasketBid = {
      _id: offBasketBidId,
      corporationId: offBasketCorpId,
      placerFundId: fundId,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 50,
      escrowAmount: 250,
      escrowAnchor: 250,
      updatedAt: new Date(),
    };

    // in-basket bid: corp IS in targetConstituents but float fully covered deficit
    // this turn (inBasketCorp has float=10000 here so no bid leg in plan)
    const inBasketCorpWithFloat = { ...inBasketCorp, publicFloat: 10_000 };
    const inBasketBid = {
      _id: inBasketBidId,
      corporationId: inBasketCorpId,
      placerFundId: fundId,
      type: "buy",
      status: "open",
      createdAt: new Date(),
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 102,
      escrowAmount: 510,
      escrowAnchor: 510,
      updatedAt: new Date(),
    };

    const mockDb = buildBidMockDb([
      offBasketBid as unknown as import("mongodb").WithId<import("mongodb").Document>,
      inBasketBid as unknown as import("mongodb").WithId<import("mongodb").Document>,
    ]);

    await rebalanceFundToTarget(
      mockDb as unknown as DbArg,
      baseFund,
      [inBasketCorpWithFloat as unknown as Parameters<typeof rebalanceFundToTarget>[2][number]],
      {},
      new Map(),
      5
    );

    // Off-basket bid MUST be cancelled
    expect(cancelFundShareOrder).toHaveBeenCalledWith(expect.anything(), offBasketBidId);

    // In-basket bid MUST NOT be cancelled (regression guard for Finding 1)
    const cancelCalls = vi.mocked(cancelFundShareOrder).mock.calls.map((c) => c[1].toString());
    expect(cancelCalls).not.toContain(inBasketBidId.toString());
  });

  it("cancels stale bids older than INDEX_FUND_BID_MAX_OPEN_TURNS", async () => {
    const { getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getFundById).mockResolvedValue(baseFund);

    const { cancelFundShareOrder } = await import("@/lib/indexFunds/fundShareOrders");
    const { sellFundHoldingShares } = await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });

    const { MS_PER_TURN } = await import("@/lib/constants/turnTime");

    // Create a bid that is 25 turns old (> INDEX_FUND_BID_MAX_OPEN_TURNS = 24)
    const staleBidId = new ObjectId();
    const staleCreatedAt = new Date(Date.now() - 25 * MS_PER_TURN);

    const staleBid = {
      _id: staleBidId,
      corporationId: inBasketCorpId, // in-basket, so only cancelled due to age
      placerFundId: fundId,
      type: "buy",
      status: "open",
      createdAt: staleCreatedAt,
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 102,
      escrowAmount: 510,
      escrowAnchor: 510,
      updatedAt: staleCreatedAt,
    };

    const mockDb = buildBidMockDb([
      staleBid as unknown as import("mongodb").WithId<import("mongodb").Document>,
    ]);

    await rebalanceFundToTarget(
      mockDb as unknown as DbArg,
      baseFund,
      [inBasketCorp as unknown as Parameters<typeof rebalanceFundToTarget>[2][number]],
      {},
      new Map(),
      5
    );

    // Stale bid must be cancelled even though corp is in basket
    expect(cancelFundShareOrder).toHaveBeenCalledWith(expect.anything(), staleBidId);
  });
});

// ---------------------------------------------------------------------------
// processQueuedRedemptions — caller key propagation through the keyed primitive
// ---------------------------------------------------------------------------

describe("fundCron — processQueuedRedemptions caller key propagation", () => {
  it("pays an NPP slice through the keyed primitive with an entry+turn key", async () => {
    const { buildQueuedRedemptionKey } = await import("./queuedRedemptionSpend");
    const db = createMockDb();
    const fundId = new ObjectId();
    const entryId = new ObjectId();
    const holderNppId = new ObjectId();
    const fund: IndexFund = {
      _id: fundId,
      slug: "key-test",
      name: "Key Test Fund",
      tickerSymbol: "KTF",
      scope: "country",
      kind: "broad",
      countryId: "US",
      anchorCurrencyCode: "USD",
      status: "active",
      quotedNav: 100,
      unitSupply: 100,
      reserveUnits: 0,
      cashAnchor: 5_000,
      targetConstituents: [],
      holdings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const queueEntry: IndexFundRedemptionQueueEntry = {
      _id: entryId,
      fundId,
      holderKind: "npp",
      nppId: holderNppId,
      units: 10,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 1_000,
      paidAmountAnchor: 0,
      status: "queued",
      unitsBurnedAtRequest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { listPendingRedemptions, getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(listPendingRedemptions).mockResolvedValueOnce([queueEntry]);
    vi.mocked(getFundById).mockResolvedValueOnce(null);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValueOnce(queueEntry);

    const paid = await processQueuedRedemptions(db as never, fund, false, 1);

    expect(paid).toBe(1);
    // Caller-propagated key: one payout per entry and turn.
    const expectedKey = buildQueuedRedemptionKey(entryId, 1);
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expectedKey }),
      undefined
    );
    // Guarded fund debit at the pinned slice amount.
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: fundId, cashAnchor: { $gte: 1_000 } }),
      expect.objectContaining({ $inc: expect.objectContaining({ cashAnchor: -1_000 }) }),
      undefined
    );
    // NPP credit moves anchor, and the queue settles paid.
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: holderNppId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ nppInvestmentCashAnchor: 1_000 }),
      }),
      undefined
    );
    expect(db.collectionMocks.indexFundRedemptionQueue.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: entryId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "paid" }) }),
      undefined
    );
    expect(db.collectionMocks.indexFundTransactions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "redemption", units: 10, amountAnchor: 1_000 }),
      undefined
    );
  });

  it("restores the claim and breaks the pass when the fund debit loses its race", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const firstEntryId = new ObjectId();
    const secondEntryId = new ObjectId();
    const holderNppId = new ObjectId();
    const fund: IndexFund = {
      _id: fundId,
      slug: "race-test",
      name: "Race Test Fund",
      tickerSymbol: "RTF",
      scope: "country",
      kind: "broad",
      countryId: "US",
      anchorCurrencyCode: "USD",
      status: "active",
      quotedNav: 100,
      unitSupply: 100,
      reserveUnits: 0,
      cashAnchor: 5_000,
      targetConstituents: [],
      holdings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const makeEntry = (id: ObjectId): IndexFundRedemptionQueueEntry => ({
      _id: id,
      fundId,
      holderKind: "npp",
      nppId: holderNppId,
      units: 10,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 1_000,
      paidAmountAnchor: 0,
      status: "queued",
      unitsBurnedAtRequest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { listPendingRedemptions, getFundById } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(listPendingRedemptions).mockResolvedValueOnce([
      makeEntry(firstEntryId),
      makeEntry(secondEntryId),
    ]);
    vi.mocked(getFundById).mockResolvedValueOnce(null);
    db.collection("indexFundRedemptionQueue");
    db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mockResolvedValueOnce(
      makeEntry(firstEntryId)
    );
    db.collection("indexFunds");
    db.collectionMocks.indexFunds.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    const paid = await processQueuedRedemptions(db as never, fund, false, 1);

    expect(paid).toBe(0);
    // Claim restored to queued, and the pass broke before the second entry.
    expect(db.collectionMocks.indexFundRedemptionQueue.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: firstEntryId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "queued" }) })
    );
    expect(db.collectionMocks.indexFundRedemptionQueue.findOneAndUpdate.mock.calls).toHaveLength(1);
  });
});
