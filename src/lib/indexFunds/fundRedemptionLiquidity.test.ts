import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  planProportionalHoldingsSale,
  sellFundHoldingsForRedemptionCash,
  sellFundHoldingShares,
} from "./fundRedemptionLiquidity";
import { buildFundShareSellKey } from "./fundShareSellSpend";
import { MoneyFlowKeyConflictError } from "@/lib/db/nonAtomicMoneyFlow";
import type { IndexFund } from "@/lib/db/types";

const { applySellMock, quoteMock, supportMock, getMongoClientMock } = vi.hoisted(() => ({
  applySellMock: vi.fn(),
  quoteMock: vi.fn(),
  supportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
  getDb: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundShareSellSpend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fundShareSellSpend")>();
  return { ...actual, applyFundShareSellSpend: applySellMock };
});

vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/corporations/marketExecution", () => ({
  isOrderFlowPriceEligible: vi.fn().mockReturnValue(false),
  resolveShareExecutionPrice: vi
    .fn()
    .mockImplementation((corp: { sharePrice: number }) => corp.sharePrice),
}));

vi.mock("@/lib/equities/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/equities/marketPool")>();
  return { ...actual, loadEquityQuote: quoteMock };
});

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

// ---------------------------------------------------------------------------
// Minimal Db fake: canned corporations rows, a Map-backed receipts
// collection honoring the claim/insert/find/update shapes the pass uses, and
// a corporations updateOne that records the post-commit registry sweep.
// ---------------------------------------------------------------------------

function makeReceipts(failOnWriteCount?: number) {
  const docs = new Map<string, Record<string, unknown>>();
  let writes = 0;
  let limit = failOnWriteCount;
  const maybeFail = (): void => {
    writes += 1;
    if (limit !== undefined && writes >= limit) {
      throw new Error("INJECTED_RECEIPT_FAULT");
    }
  };
  return {
    docs,
    setFaultLimit(next: number | undefined): void {
      limit = next;
    },
    insertOne: vi.fn().mockImplementation(async (doc: Record<string, unknown>) => {
      const key = String(doc._id);
      if (docs.has(key)) {
        const error = new Error("E11000 duplicate key error") as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      maybeFail();
      docs.set(key, { ...doc });
      return { insertedId: doc._id };
    }),
    findOne: vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
      const doc = docs.get(String(filter._id));
      return doc ? { ...doc } : null;
    }),
    updateOne: vi.fn().mockImplementation(async (filter: unknown, update: unknown) => {
      maybeFail();
      const doc = docs.get(String((filter as Record<string, unknown>)._id));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, (update as Record<string, Record<string, unknown>>).$set ?? {});
      return { matchedCount: 1 };
    }),
  };
}

type ReceiptsFake = ReturnType<typeof makeReceipts>;

function buildMockDb(corps: Record<string, unknown>[], receipts: ReceiptsFake) {
  const corporationsColl = {
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(corps),
      }),
    }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "corporations") return corporationsColl;
      if (name === "nonAtomicMoneyFlowReceipts") return receipts;
      return { updateOne: vi.fn(), insertOne: vi.fn(), find: vi.fn() };
    }),
    _corporationsColl: corporationsColl,
    _receipts: receipts,
  };
}

type MockDb = ReturnType<typeof buildMockDb>;

const fundId = new ObjectId();
const corpA = new ObjectId();
const corpB = new ObjectId();

function baseFund(overrides?: Partial<IndexFund>): IndexFund {
  return {
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
      { corporationId: corpA, shares: 200, avgCostPerShareAnchor: 10, lastValueAnchor: 2000 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseCorp(id: ObjectId, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: id,
    name: id.equals(corpA) ? "CorpA" : "CorpB",
    sharePrice: 10,
    fundamentalSharePrice: 10,
    publicFloat: 500,
    totalShares: 10_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    shareBuybackMode: undefined,
    shareEscrowBalance: 0,
    ...overrides,
  };
}

function mockQuote(overrides?: Record<string, unknown>): void {
  quoteMock.mockResolvedValue({
    active: true,
    currency: "USD",
    bidPriceLocal: 10,
    askPriceLocal: 10,
    bidDepthShares: Number.MAX_SAFE_INTEGER,
    askDepthShares: 500,
    ...overrides,
  });
}

/** Default apply mock: the pinned sale lands exactly as pinned. */
function mockApplySuccess(): void {
  applySellMock.mockImplementation(async (_db: unknown, input: Record<string, unknown>) => ({
    duplicate: false,
    outcome: {
      sharesSold: input.sharesToSell,
      cashRaisedAnchor: input.proceedsAnchor,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  getMongoClientMock.mockReturnValue(undefined);
  mockQuote();
  mockApplySuccess();
});

// ---------------------------------------------------------------------------
// sellFundHoldingShares shell
// ---------------------------------------------------------------------------

describe("sellFundHoldingShares shell", () => {
  function shellDb(): MockDb {
    return buildMockDb([baseCorp(corpA)], makeReceipts());
  }

  it("sells exactly min(maxShares, held) when maxShares < held", async () => {
    const db = shellDb();
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 50);

    expect(result).toEqual({ cashRaisedAnchor: 500, sharesSold: 50, salesExecuted: 1 });
    expect(applySellMock).toHaveBeenCalledTimes(1);
    const input = applySellMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      fundId,
      corpId: corpA,
      sharesToSell: 50,
      executionPriceLocal: 10,
      pricePerShareAnchor: 10,
      proceedsAnchor: 500,
      issuerDebitLocal: 500,
      issuerRoute: "pool",
      counterparty: "market",
      currency: "USD",
      turn: 5,
      note: "Redemption liquidity",
    });
    // Deterministic caller key: fund + corp + turn + shares.
    expect(input.idempotencyKey).toBe(buildFundShareSellKey(fundId, corpA, 5, 50));
    expect(typeof input.fingerprint).toBe("string");

    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    expect(recordShareTrade).toHaveBeenCalledTimes(1);
    expect(recordShareTrade).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ corporationId: corpA, kind: "market_sell", shares: 50 })
    );
  });

  it("sells exactly held when maxShares > held", async () => {
    const db = shellDb();
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 999);
    expect(result.sharesSold).toBe(200);
    expect(result.salesExecuted).toBe(1);
  });

  it("caps the sale at the finite pool bid depth", async () => {
    mockQuote({ bidDepthShares: 5, bidPriceLocal: 9.8 });
    const db = shellDb();
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 50);
    expect(result.sharesSold).toBe(5);
    const input = applySellMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.sharesToSell).toBe(5);
  });

  it("returns zeros when the holding is missing, the corp is gone, or the quote is unusable", async () => {
    const db = shellDb();
    expect(await sellFundHoldingShares(db as never, baseFund({ holdings: [] }), corpA, 50)).toEqual(
      {
        cashRaisedAnchor: 0,
        sharesSold: 0,
        salesExecuted: 0,
      }
    );
    const emptyDb = buildMockDb([], makeReceipts());
    expect(await sellFundHoldingShares(emptyDb as never, baseFund(), corpA, 50)).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    mockQuote({ bidPriceLocal: 0 });
    expect(await sellFundHoldingShares(db as never, baseFund(), corpA, 50)).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    expect(applySellMock).not.toHaveBeenCalled();
  });

  it("keeps explicit corporate buyouts issuer-funded at fair mid", async () => {
    mockQuote({ active: true, bidDepthShares: 0, bidPriceLocal: 9.5 });
    const db = shellDb();
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 50, {
      settlementCounterparty: "issuer",
      note: "Take-private buyout",
    });
    // Depth 0 would cap a market sale to nothing; the issuer route ignores it.
    expect(result).toMatchObject({ sharesSold: 50, cashRaisedAnchor: 500 });
    const input = applySellMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      counterparty: "issuer",
      executionPriceLocal: 10,
      issuerRoute: "liquid",
      note: "Take-private buyout",
    });
  });

  it("pins the escrow split from quote-time pre-state", async () => {
    mockQuote({ active: false, bidPriceLocal: 9 });
    const db = buildMockDb(
      [baseCorp(corpA, { shareBuybackMode: "escrow", shareEscrowBalance: 300 })],
      makeReceipts()
    );
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 50);
    expect(result.sharesSold).toBe(50);
    const input = applySellMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      issuerRoute: "escrow",
      escrowDebited: 300,
      // 50 shares at the 9 bid = 450 issuer debit, 300 from escrow.
      issuerDebitLocal: 450,
      treasuryDebited: 150,
    });
  });

  it("honors an explicit caller key", async () => {
    const db = shellDb();
    await sellFundHoldingShares(db as never, baseFund(), corpA, 50, {
      keyOptions: { idempotencyKey: "caller-key-1" },
    });
    expect(applySellMock.mock.calls[0]![1]).toMatchObject({ idempotencyKey: "caller-key-1" });
  });

  it("maps lost issuer/float races to zeros and throws pathological failures", async () => {
    const db = shellDb();
    applySellMock.mockRejectedValueOnce(new Error("FUND_SHARE_SELL_ISSUER:guard-rejected"));
    expect(await sellFundHoldingShares(db as never, baseFund(), corpA, 50)).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    applySellMock.mockRejectedValueOnce(new Error("FUND_SHARE_SELL_RELEASE:guard-rejected"));
    expect(await sellFundHoldingShares(db as never, baseFund(), corpA, 50)).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    applySellMock.mockRejectedValueOnce(new Error("FUND_SHARE_SELL_CREDIT:missing"));
    await expect(sellFundHoldingShares(db as never, baseFund(), corpA, 50)).rejects.toThrow(
      "FUND_SHARE_SELL_CREDIT"
    );
    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    // Skips and failures fire no trade log.
    expect(recordShareTrade).not.toHaveBeenCalled();
  });

  it("does not refire post-commit effects on a same-key replay", async () => {
    const db = shellDb();
    applySellMock.mockResolvedValueOnce({
      duplicate: true,
      outcome: { sharesSold: 50, cashRaisedAnchor: 500 },
    });
    const result = await sellFundHoldingShares(db as never, baseFund(), corpA, 50);
    expect(result).toEqual({ cashRaisedAnchor: 500, sharesSold: 50, salesExecuted: 1 });
    const { recordShareTrade } = await import("@/lib/corporations/shareTradeHistory");
    expect(recordShareTrade).not.toHaveBeenCalled();
    expect(db._corporationsColl.updateOne).not.toHaveBeenCalled();
  });

  it("sweeps the registry row when the sale empties the position", async () => {
    const db = shellDb();
    await sellFundHoldingShares(db as never, baseFund(), corpA, 200);
    expect(db._corporationsColl.updateOne).toHaveBeenCalledWith(
      { _id: corpA },
      { $pull: { shareholders: { fundId, shares: { $lte: 0 } } } },
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// sellFundHoldingsForRedemptionCash pass
// ---------------------------------------------------------------------------

describe("sellFundHoldingsForRedemptionCash pass", () => {
  function passDb(): MockDb {
    return buildMockDb([baseCorp(corpA), baseCorp(corpB)], makeReceipts());
  }

  function twoHoldingFund(): IndexFund {
    return baseFund({
      holdings: [
        { corporationId: corpA, shares: 100, avgCostPerShareAnchor: 10, lastValueAnchor: 1000 },
        { corporationId: corpB, shares: 50, avgCostPerShareAnchor: 10, lastValueAnchor: 500 },
      ],
    });
  }

  it("sequences proportional sales until the cash need is met", async () => {
    const db = passDb();
    const result = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 750, {
      idempotencyKey: "pass-seq-1",
    });
    expect(result.cashRaisedAnchor).toBeGreaterThanOrEqual(500);
    expect(result.cashRaisedAnchor).toBeLessThanOrEqual(750);
    expect(result.sharesSold).toBeGreaterThan(0);
    expect(result.salesExecuted).toBeGreaterThanOrEqual(1);
    // Every leg runs under a deterministic sub-key of the parent key.
    for (const call of applySellMock.mock.calls) {
      expect(String(call[1].idempotencyKey)).toMatch(/^pass-seq-1:equity:/);
    }
    // One parent receipt, settled completed.
    expect(db._receipts.docs.get("pass-seq-1")).toMatchObject({ status: "completed" });
  });

  it("stops at the cash cap instead of liquidating everything", async () => {
    const db = buildMockDb([baseCorp(corpA)], makeReceipts());
    const result = await sellFundHoldingsForRedemptionCash(db as never, baseFund(), 50, {
      idempotencyKey: "pass-cap-1",
    });
    expect(result).toEqual({ cashRaisedAnchor: 50, sharesSold: 5, salesExecuted: 1 });
    expect(applySellMock).toHaveBeenCalledTimes(1);
  });

  it("skips a lost-race leg and continues with the next holding", async () => {
    const db = passDb();
    applySellMock.mockImplementation(async (_db: unknown, input: Record<string, unknown>) => {
      if (String(input.corpId) === corpA.toHexString()) {
        throw new Error("FUND_SHARE_SELL_ISSUER:guard-rejected");
      }
      return {
        duplicate: false,
        outcome: { sharesSold: input.sharesToSell, cashRaisedAnchor: input.proceedsAnchor },
      };
    });
    const result = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
      idempotencyKey: "pass-skip-1",
    });
    expect(result.salesExecuted).toBe(1);
    expect(result.sharesSold).toBe(50);
    expect(db._receipts.docs.get("pass-skip-1")).toMatchObject({ status: "completed" });
  });

  it("skips a conflicting leg instead of selling twice", async () => {
    const db = passDb();
    applySellMock.mockRejectedValueOnce(new MoneyFlowKeyConflictError("k"));
    const result = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
      idempotencyKey: "pass-conflict-1",
    });
    expect(result.salesExecuted).toBeGreaterThanOrEqual(1);
    expect(db._receipts.docs.get("pass-conflict-1")).toMatchObject({ status: "completed" });
  });

  it("aborts the pass on a pathological leg after settling the parent failed", async () => {
    const db = passDb();
    applySellMock.mockRejectedValueOnce(new Error("FUND_SHARE_SELL_CREDIT:missing"));
    await expect(
      sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
        idempotencyKey: "pass-abort-1",
      })
    ).rejects.toThrow("FUND_SHARE_SELL_CREDIT");
    expect(db._receipts.docs.get("pass-abort-1")).toMatchObject({ status: "failed" });
  });

  it("a same-key retry replays the stored legs instead of selling twice", async () => {
    const receipts = makeReceipts();
    const db = buildMockDb([baseCorp(corpA), baseCorp(corpB)], receipts);
    const first = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
      idempotencyKey: "pass-replay-1",
    });
    expect(applySellMock).toHaveBeenCalled();
    const callsBefore = applySellMock.mock.calls.length;

    // The world moved on (repriced quotes, drained depth), but the retry must
    // reuse the stored legs, not the live market.
    mockQuote({ bidPriceLocal: 999, bidDepthShares: 1 });
    const second = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
      idempotencyKey: "pass-replay-1",
    });
    expect(second).toEqual(first);
    expect(applySellMock.mock.calls.length).toBe(callsBefore);
    // No second liquidation: the stored outcome reports the landed cash.
    expect(second.cashRaisedAnchor).toBe(first.cashRaisedAnchor);
  });

  it("resumes an in-progress pass from the stored legs after a mid-pass crash", async () => {
    // Crash on the settle write: legs landed, the parent never completed.
    const receipts = makeReceipts(3);
    const db = buildMockDb([baseCorp(corpA), baseCorp(corpB)], receipts);
    await expect(
      sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
        idempotencyKey: "pass-crash-1",
      })
    ).rejects.toThrow("INJECTED_RECEIPT_FAULT");
    expect(receipts.docs.get("pass-crash-1")).toMatchObject({ status: "in_progress" });
    const landedCalls = applySellMock.mock.calls.length;
    expect(landedCalls).toBeGreaterThan(0);

    // Recovery under the same key replays the stored legs: completed legs
    // reconcile as duplicates (the mock now reports duplicates), the
    // remaining need shrinks by the landed cash, and nothing sells twice.
    // The fault injector stands down so the recovery settle can land.
    receipts.setFaultLimit(undefined);
    applySellMock.mockImplementation(async (_db: unknown, input: Record<string, unknown>) => ({
      duplicate: true,
      outcome: { sharesSold: input.sharesToSell, cashRaisedAnchor: input.proceedsAnchor },
    }));
    mockQuote({ bidPriceLocal: 999 });
    const recovered = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 1500, {
      idempotencyKey: "pass-crash-1",
    });
    expect(recovered.cashRaisedAnchor).toBeGreaterThan(0);
    // Every replayed leg carries the ORIGINAL pinned price, not the live 999.
    for (const call of applySellMock.mock.calls.slice(landedCalls)) {
      expect(call[1]).toMatchObject({ executionPriceLocal: 10, pricePerShareAnchor: 10 });
    }
    expect(receipts.docs.get("pass-crash-1")).toMatchObject({ status: "completed" });
  });

  it("fails closed when the parent key is reused for a different liquidation", async () => {
    const receipts = makeReceipts();
    const db = buildMockDb([baseCorp(corpA), baseCorp(corpB)], receipts);
    await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 750, {
      idempotencyKey: "pass-fp-1",
    });
    await expect(
      sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 751, {
        idempotencyKey: "pass-fp-1",
      })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });

  it("forwards the caller session to the legs", async () => {
    const db = passDb();
    const session = { id: "outer-tx" };
    await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 100, {
      idempotencyKey: "pass-sess-1",
      session: session as never,
    });
    for (const call of applySellMock.mock.calls) {
      expect(call[2]).toEqual({ session });
    }
  });

  it("sells every named holding in full on the filtered branch", async () => {
    const db = passDb();
    const result = await sellFundHoldingsForRedemptionCash(db as never, twoHoldingFund(), 10_000, {
      corporationIds: [corpB],
      idempotencyKey: "pass-filter-1",
    });
    expect(applySellMock).toHaveBeenCalledTimes(1);
    expect(applySellMock.mock.calls[0]![1]).toMatchObject({ corpId: corpB, sharesToSell: 50 });
    expect(result).toEqual({ cashRaisedAnchor: 500, sharesSold: 50, salesExecuted: 1 });
  });

  it("returns zeros without claiming when there is nothing to sell", async () => {
    const db = passDb();
    expect(await sellFundHoldingsForRedemptionCash(db as never, baseFund(), 0)).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    expect(
      await sellFundHoldingsForRedemptionCash(db as never, baseFund({ holdings: [] }), 500)
    ).toEqual({
      cashRaisedAnchor: 0,
      sharesSold: 0,
      salesExecuted: 0,
    });
    expect(applySellMock).not.toHaveBeenCalled();
    expect(db._receipts.docs.size).toBe(0);
  });
});

describe("planProportionalHoldingsSale", () => {
  const corpC = new ObjectId();
  const corpD = new ObjectId();

  it("returns empty when no cash is needed", () => {
    expect(
      planProportionalHoldingsSale(
        [{ corporationId: corpC, shares: 100, pricePerShareAnchor: 10 }],
        0
      )
    ).toEqual([]);
  });

  it("sells all holdings when cash need exceeds portfolio value", () => {
    expect(
      planProportionalHoldingsSale(
        [
          { corporationId: corpC, shares: 10, pricePerShareAnchor: 100 },
          { corporationId: corpD, shares: 5, pricePerShareAnchor: 20 },
        ],
        2000
      )
    ).toEqual([
      {
        corporationId: corpC,
        shares: 10,
        pricePerShareAnchor: 100,
        sharesToSell: 10,
        proceedsAnchor: 1000,
      },
      {
        corporationId: corpD,
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
        { corporationId: corpC, shares: 100, pricePerShareAnchor: 10 },
        { corporationId: corpD, shares: 50, pricePerShareAnchor: 10 },
      ],
      750
    );

    const totalProceeds = plan.reduce((sum, row) => sum + row.proceedsAnchor, 0);
    expect(totalProceeds).toBeGreaterThanOrEqual(500);
    expect(totalProceeds).toBeLessThanOrEqual(750);
    expect(plan.find((p) => p.corporationId.equals(corpC))?.sharesToSell).toBeGreaterThan(
      plan.find((p) => p.corporationId.equals(corpD))?.sharesToSell ?? 0
    );
  });
});
