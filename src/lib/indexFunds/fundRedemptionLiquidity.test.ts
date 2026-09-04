import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { planProportionalHoldingsSale, sellFundHoldingShares } from "./fundRedemptionLiquidity";
import type { IndexFund } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// Mocks for sellFundHoldingShares (avoids a live MongoDB dependency)
// ---------------------------------------------------------------------------

vi.mock("@/lib/corporations/shareholderOps", () => ({
  debitSharesFromFund: vi.fn().mockResolvedValue(10), // remaining shares > 0 = success
}));

vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  settleFloatSellDebit: vi.fn().mockResolvedValue({ ok: true }),
  reverseFloatSellDebit: vi.fn().mockResolvedValue(undefined),
  onFloatSellCommitted: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  shareTradeAnchorValue: vi
    .fn()
    .mockImplementation(
      (shares: number, corp: { sharePrice: number }, _fxRate: number) => shares * corp.sharePrice
    ),
}));

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(5),
}));

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  updateFundHoldings: vi.fn().mockResolvedValue(undefined),
  insertFundTransaction: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// sellFundHoldingShares tests
// ---------------------------------------------------------------------------

describe("sellFundHoldingShares", () => {
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
    cashAnchor: 0,
    targetConstituents: [],
    holdings: [
      {
        corporationId: corpId,
        shares: 200,
        avgCostPerShareAnchor: 10,
        lastValueAnchor: 2000,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseCorp = {
    _id: corpId,
    name: "TestCorp",
    sharePrice: 10,
    fundamentalSharePrice: 10,
    publicFloat: 500,
    totalShares: 10_000,
    liquidCurrencyCode: "USD" as const,
    countryId: "US",
    shareBuybackMode: undefined,
  };

  function buildMockDb(equityPool: Record<string, unknown> | null = null) {
    let cashAnchor = baseFund.cashAnchor;
    const fundTransactions: unknown[] = [];

    const indexFundsColl = {
      updateOne: vi
        .fn()
        .mockImplementation((_filter: unknown, update: { $inc?: { cashAnchor?: number } }) => {
          cashAnchor += update.$inc?.cashAnchor ?? 0;
          return Promise.resolve({ matchedCount: 1 });
        }),
    };

    const corporationsColl = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([baseCorp]),
        }),
      }),
    };

    const fundTransactionsColl = {
      insertOne: vi.fn().mockImplementation((doc: unknown) => {
        fundTransactions.push(doc);
        return Promise.resolve({ insertedId: new ObjectId() });
      }),
    };

    return {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "indexFunds") return indexFundsColl;
        if (name === "corporations") return corporationsColl;
        if (name === "indexFundTransactions") return fundTransactionsColl;
        if (name === "equityMarketPools") {
          return { findOne: vi.fn().mockResolvedValue(equityPool) };
        }
        return { updateOne: vi.fn(), insertOne: vi.fn(), find: vi.fn() };
      }),
      _getCashAnchor: () => cashAnchor,
      _getFundTransactions: () => fundTransactions,
      _indexFundsColl: indexFundsColl,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sells exactly min(maxShares, held) when maxShares < held", async () => {
    const mockDb = buildMockDb();
    const { insertFundTransaction } = await import("@/lib/indexFunds/fundQueries");
    const { debitSharesFromFund } = await import("@/lib/corporations/shareholderOps");

    // maxShares = 50, held = 200 — should sell exactly 50
    const result = await sellFundHoldingShares(
      mockDb as unknown as import("mongodb").Db,
      baseFund,
      corpId,
      50
    );

    expect(result.sharesSold).toBe(50);
    expect(result.salesExecuted).toBe(1);
    expect(result.cashRaisedAnchor).toBeCloseTo(50 * 10, 2); // 50 shares × $10

    // debitSharesFromFund called with 50 shares
    expect(debitSharesFromFund).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      fundId,
      50,
      expect.anything(),
      expect.anything()
    );

    // public_float_sell transaction emitted
    expect(insertFundTransaction).toHaveBeenCalled();
    const txDoc = vi.mocked(insertFundTransaction).mock.calls[0]![1]!;
    expect(txDoc).toMatchObject({ kind: "public_float_sell", shares: 50 });
  });

  it("sells exactly held when maxShares > held", async () => {
    const mockDb = buildMockDb();

    // maxShares = 999, held = 200 — should sell exactly 200
    const result = await sellFundHoldingShares(
      mockDb as unknown as import("mongodb").Db,
      baseFund,
      corpId,
      999
    );

    expect(result.sharesSold).toBe(200);
    expect(result.salesExecuted).toBe(1);
  });

  it("returns zeros when holding is not found", async () => {
    const mockDb = buildMockDb();
    const fundWithNoHoldings: IndexFund = { ...baseFund, holdings: [] };

    const result = await sellFundHoldingShares(
      mockDb as unknown as import("mongodb").Db,
      fundWithNoHoldings,
      corpId,
      50
    );

    expect(result.sharesSold).toBe(0);
    expect(result.salesExecuted).toBe(0);
    expect(result.cashRaisedAnchor).toBe(0);
  });

  it("credits proceeds to fund cashAnchor", async () => {
    const mockDb = buildMockDb();

    await sellFundHoldingShares(mockDb as unknown as import("mongodb").Db, baseFund, corpId, 10);

    // Should have incremented cashAnchor by 10 × $10 = 100
    expect(mockDb._getCashAnchor()).toBeCloseTo(100, 2);
    const updateCall = mockDb._indexFundsColl.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: fundId });
    expect(updateCall[1]).toMatchObject({ $inc: { cashAnchor: expect.any(Number) } });
  });

  it("partially fills at the finite pool's bid depth", async () => {
    const mockDb = buildMockDb({
      _id: "USD",
      cashLocal: 49,
      targetCashLocal: 49,
    });
    const { debitSharesFromFund } = await import("@/lib/corporations/shareholderOps");

    const result = await sellFundHoldingShares(
      mockDb as unknown as import("mongodb").Db,
      baseFund,
      corpId,
      50
    );

    expect(result.sharesSold).toBe(5); // $49 / $9.80 bid
    expect(result.cashRaisedAnchor).toBe(49);
    expect(debitSharesFromFund).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      fundId,
      5,
      expect.anything(),
      expect.anything()
    );
  });

  it("keeps explicit corporate buyouts issuer-funded at fair mid", async () => {
    const mockDb = buildMockDb({
      _id: "USD",
      cashLocal: 0,
      targetCashLocal: 100,
    });
    const { settleFloatSellDebit } = await import("@/lib/corporations/shareEscrowSettlement");

    const result = await sellFundHoldingShares(
      mockDb as unknown as import("mongodb").Db,
      baseFund,
      corpId,
      50,
      { settlementCounterparty: "issuer" }
    );

    expect(result).toMatchObject({ sharesSold: 50, cashRaisedAnchor: 500 });
    expect(settleFloatSellDebit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: corpId }),
      500,
      expect.objectContaining({ counterparty: "issuer" })
    );
  });
});

describe("planProportionalHoldingsSale", () => {
  const corpA = new ObjectId();
  const corpB = new ObjectId();

  it("returns empty when no cash is needed", () => {
    expect(
      planProportionalHoldingsSale(
        [{ corporationId: corpA, shares: 100, pricePerShareAnchor: 10 }],
        0
      )
    ).toEqual([]);
  });

  it("sells all holdings when cash need exceeds portfolio value", () => {
    expect(
      planProportionalHoldingsSale(
        [
          { corporationId: corpA, shares: 10, pricePerShareAnchor: 100 },
          { corporationId: corpB, shares: 5, pricePerShareAnchor: 20 },
        ],
        2000
      )
    ).toEqual([
      {
        corporationId: corpA,
        shares: 10,
        pricePerShareAnchor: 100,
        sharesToSell: 10,
        proceedsAnchor: 1000,
      },
      {
        corporationId: corpB,
        shares: 5,
        pricePerShareAnchor: 20,
        sharesToSell: 5,
        proceedsAnchor: 100,
      },
    ]);
  });

  it("allocates sales proportionally by holding value", () => {
    const plan = planProportionalHoldingsSale(
      [
        { corporationId: corpA, shares: 100, pricePerShareAnchor: 10 },
        { corporationId: corpB, shares: 50, pricePerShareAnchor: 10 },
      ],
      750
    );

    const totalProceeds = plan.reduce((sum, row) => sum + row.proceedsAnchor, 0);
    expect(totalProceeds).toBeGreaterThanOrEqual(500);
    expect(totalProceeds).toBeLessThanOrEqual(750);
    expect(plan.find((p) => p.corporationId.equals(corpA))?.sharesToSell).toBeGreaterThan(
      plan.find((p) => p.corporationId.equals(corpB))?.sharesToSell ?? 0
    );
  });
});
