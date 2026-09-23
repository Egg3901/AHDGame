import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";

const orderMocks = vi.hoisted(() => ({
  cancelFundShareOrder: vi.fn(),
  placeFundShareBuyOrder: vi.fn(),
  placeFundShareSellOrder: vi.fn(),
}));
const ledgerMocks = vi.hoisted(() => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/indexFunds/fundShareOrders", () => orderMocks);
vi.mock("@/lib/financialTxLog/emit", () => ledgerMocks);

import {
  EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND,
  planEquityLiquidityQuotes,
  refreshEquityLiquidityFacility,
  type EquityLiquidityListing,
} from "./equityLiquidityFacility";

function fund(corporationIds: ObjectId[]): IndexFund {
  return {
    _id: new ObjectId(),
    slug: "test",
    name: "Test Fund",
    tickerSymbol: "TEST",
    scope: "global",
    kind: "broad",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000_000,
    reserveUnits: 0,
    cashAnchor: 10_000_000,
    targetConstituents: [],
    holdings: corporationIds.map((corporationId) => ({
      corporationId,
      shares: 100_000,
      lastValueAnchor: 10_000_000,
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function listing(corporationId: ObjectId): EquityLiquidityListing {
  return {
    corporationId,
    referencePriceLocal: 100,
    referencePriceAnchor: 100,
    totalShares: 1_000_000,
    fxRate: 1,
    corporation: { _id: corporationId, countryId: "US", liquidCurrencyCode: "USD" },
  };
}

function facilityDb(priorOrders: Array<{ _id: ObjectId; placerFundId?: ObjectId }> = []): {
  db: Db;
  replaceOne: ReturnType<typeof vi.fn>;
} {
  const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "shareOrders") {
        return {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(priorOrders) })),
        };
      }
      if (name === "equityLiquidityFacilitySnapshots") return { replaceOne };
      throw new Error(`Unexpected collection ${name}`);
    }),
  } as unknown as Db;
  return { db, replaceOne };
}

beforeEach(() => {
  vi.clearAllMocks();
  orderMocks.cancelFundShareOrder.mockResolvedValue(undefined);
});

describe("planEquityLiquidityQuotes", () => {
  it("creates symmetric executable quotes inside every risk cap", () => {
    const corporationId = new ObjectId();
    const provider = fund([corporationId]);
    const plans = planEquityLiquidityQuotes({
      funds: [provider],
      listings: [listing(corporationId)],
      totalListings: 10,
      turn: 50,
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      fundId: provider._id,
      corporationId,
      bidPriceLocal: 98,
      askPriceLocal: 102,
      bidShares: 500,
      askShares: 500,
    });
    expect(plans[0].stressLossAnchor).toBe(5_000);
  });

  it("caps participation per fund even when it holds every listing", () => {
    const ids = Array.from(
      { length: EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND + 16 },
      () => new ObjectId()
    );
    const provider = fund(ids);
    provider.cashAnchor = 100_000_000;
    const plans = planEquityLiquidityQuotes({
      funds: [provider],
      listings: ids.map(listing),
      totalListings: ids.length,
      turn: 51,
    });

    expect(plans).toHaveLength(EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND);
  });

  it("places a mandate-backed bid without inventing ask inventory", () => {
    const held = new ObjectId();
    const unheld = new ObjectId();
    const plans = planEquityLiquidityQuotes({
      funds: [fund([held])],
      listings: [listing(unheld)],
      totalListings: 10,
      turn: 52,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ bidShares: 500, askShares: 0 });
  });

  it("rotates capped listing coverage across turns", () => {
    const ids = Array.from({ length: 10 }, () => new ObjectId()).sort((a, b) =>
      a.toString().localeCompare(b.toString())
    );
    const provider = fund(ids);
    const input = {
      funds: [provider],
      listings: ids.map(listing),
      totalListings: 5,
    };

    const first = planEquityLiquidityQuotes({ ...input, turn: 0 });
    const second = planEquityLiquidityQuotes({ ...input, turn: 1 });

    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(first[0].corporationId).toEqual(ids[0]);
    expect(second[0].corporationId).toEqual(ids[1]);
  });
});

describe("refreshEquityLiquidityFacility", () => {
  it("batches completed cancellation refund rows for each fund", async () => {
    const provider = fund([]);
    const priorOrders = [
      { _id: new ObjectId(), placerFundId: provider._id },
      { _id: new ObjectId(), placerFundId: provider._id },
    ];
    const { db } = facilityDb(priorOrders);
    orderMocks.cancelFundShareOrder.mockImplementation(
      async (_db: Db, _id: ObjectId, _turn: number, options: { ledgerSink: unknown[] }) => {
        options.ledgerSink.push({ type: "stock_order_refund", amount: 10 });
      }
    );

    await refreshEquityLiquidityFacility({
      db,
      turn: 59,
      enabled: false,
      funds: [provider],
      listings: [],
      totalListings: 0,
    });

    expect(orderMocks.cancelFundShareOrder).toHaveBeenCalledTimes(2);
    expect(orderMocks.cancelFundShareOrder.mock.calls[0][3].fund).toBe(provider);
    expect(ledgerMocks.emitTxBulk).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.emitTxBulk.mock.calls[0][1]).toHaveLength(2);
  });

  it("still cancels quotes when the ledger threshold read fails", async () => {
    const provider = fund([]);
    const order = { _id: new ObjectId(), placerFundId: provider._id };
    const { db } = facilityDb([order]);
    ledgerMocks.loadTxThresholds.mockRejectedValueOnce(new Error("threshold unavailable"));
    orderMocks.cancelFundShareOrder.mockImplementation(
      async (_db: Db, _id: ObjectId, _turn: number, options: { ledgerSink: unknown[] }) => {
        options.ledgerSink.push({ type: "stock_order_refund", amount: 10 });
      }
    );

    await refreshEquityLiquidityFacility({
      db,
      turn: 59,
      enabled: false,
      funds: [provider],
      listings: [],
      totalListings: 0,
    });

    expect(orderMocks.cancelFundShareOrder).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.emitTx).toHaveBeenCalledTimes(1);
  });

  it("flushes completed refunds when a later cancellation fails", async () => {
    const provider = fund([]);
    const priorOrders = [
      { _id: new ObjectId(), placerFundId: provider._id },
      { _id: new ObjectId(), placerFundId: provider._id },
    ];
    const { db } = facilityDb(priorOrders);
    orderMocks.cancelFundShareOrder
      .mockImplementationOnce(
        async (_db: Db, _id: ObjectId, _turn: number, options: { ledgerSink: unknown[] }) => {
          options.ledgerSink.push({ type: "stock_order_refund", amount: 10 });
        }
      )
      .mockRejectedValueOnce(new Error("cancel failed"));

    await expect(
      refreshEquityLiquidityFacility({
        db,
        turn: 59,
        enabled: false,
        funds: [provider],
        listings: [],
        totalListings: 0,
      })
    ).rejects.toThrow("cancel failed");

    expect(ledgerMocks.emitTxBulk).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.emitTxBulk.mock.calls[0][1]).toHaveLength(1);
  });

  it("batches completed bid escrow rows for each fund", async () => {
    const corporationId = new ObjectId();
    const provider = fund([corporationId]);
    const { db } = facilityDb();
    orderMocks.placeFundShareBuyOrder.mockImplementation(
      async (_db: Db, input: { ledgerSink: unknown[] }) => {
        input.ledgerSink.push({ type: "stock_order_escrow", amount: -50 });
        return { ok: true, orderId: new ObjectId() };
      }
    );
    orderMocks.placeFundShareSellOrder.mockResolvedValue({ ok: true, orderId: new ObjectId() });

    await refreshEquityLiquidityFacility({
      db,
      turn: 59,
      enabled: true,
      funds: [provider],
      listings: [listing(corporationId)],
      totalListings: 10,
    });

    expect(ledgerMocks.emitTxBulk).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.emitTxBulk.mock.calls[0][1]).toMatchObject([
      { type: "stock_order_escrow", amount: -50 },
    ]);
  });

  it("flushes a committed bid when a later quote fails", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    const provider = fund(ids);
    const { db } = facilityDb();
    orderMocks.placeFundShareBuyOrder
      .mockImplementationOnce(async (_db: Db, input: { ledgerSink: unknown[] }) => {
        input.ledgerSink.push({ type: "stock_order_escrow", amount: -50 });
        return { ok: true, orderId: new ObjectId() };
      })
      .mockRejectedValueOnce(new Error("bid failed"));
    orderMocks.placeFundShareSellOrder.mockResolvedValue({ ok: true, orderId: new ObjectId() });

    await expect(
      refreshEquityLiquidityFacility({
        db,
        turn: 59,
        enabled: true,
        funds: [provider],
        listings: ids.map(listing),
        totalListings: 10,
      })
    ).rejects.toThrow("bid failed");

    expect(ledgerMocks.emitTxBulk).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.emitTxBulk.mock.calls[0][1]).toHaveLength(1);
  });

  it("cancels different funds concurrently while preserving each fund's order", async () => {
    const firstFundId = new ObjectId();
    const secondFundId = new ObjectId();
    const priorOrders = [
      { _id: new ObjectId(), placerFundId: firstFundId },
      { _id: new ObjectId(), placerFundId: firstFundId },
      { _id: new ObjectId(), placerFundId: secondFundId },
      { _id: new ObjectId(), placerFundId: secondFundId },
    ];
    const fundByOrder = new Map(
      priorOrders.map((order) => [order._id.toString(), order.placerFundId.toString()])
    );
    const activeByFund = new Map<string, number>();
    let activeFunds = 0;
    let peakActiveFunds = 0;
    orderMocks.cancelFundShareOrder.mockImplementation(async (_db: unknown, orderId: ObjectId) => {
      const fundId = fundByOrder.get(orderId.toString())!;
      const active = activeByFund.get(fundId) ?? 0;
      expect(active).toBe(0);
      activeByFund.set(fundId, active + 1);
      activeFunds++;
      peakActiveFunds = Math.max(peakActiveFunds, activeFunds);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeFunds--;
      activeByFund.set(fundId, 0);
    });
    const { db } = facilityDb(priorOrders);

    await refreshEquityLiquidityFacility({
      db,
      turn: 59,
      enabled: false,
      funds: [],
      listings: [],
      totalListings: 0,
    });

    expect(peakActiveFunds).toBe(2);
    expect(orderMocks.cancelFundShareOrder.mock.calls.map((call) => call[1])).toEqual([
      priorOrders[0]._id,
      priorOrders[2]._id,
      priorOrders[1]._id,
      priorOrders[3]._id,
    ]);
  });

  it("cancels prior quotes and places none when disabled", async () => {
    const priorOrders = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
    const { db, replaceOne } = facilityDb(priorOrders);

    const snapshot = await refreshEquityLiquidityFacility({
      db,
      turn: 60,
      enabled: false,
      funds: [],
      listings: [],
      totalListings: 0,
    });

    expect(orderMocks.cancelFundShareOrder).toHaveBeenCalledTimes(2);
    expect(orderMocks.placeFundShareBuyOrder).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      enabled: false,
      priorQuotesCancelled: 2,
      quotePairsPlaced: 0,
    });
    expect(replaceOne).toHaveBeenCalledWith({ turn: 60 }, snapshot, { upsert: true });
  });

  it("keeps a funded bid when the paired ask cannot be placed", async () => {
    const corporationId = new ObjectId();
    const provider = fund([corporationId]);
    const bidOrderId = new ObjectId();
    const { db } = facilityDb();
    orderMocks.placeFundShareBuyOrder.mockResolvedValue({ ok: true, orderId: bidOrderId });
    orderMocks.placeFundShareSellOrder.mockResolvedValue({ ok: false });

    const snapshot = await refreshEquityLiquidityFacility({
      db,
      turn: 61,
      enabled: true,
      funds: [provider],
      listings: [listing(corporationId)],
      totalListings: 10,
    });

    expect(orderMocks.cancelFundShareOrder).not.toHaveBeenCalledWith(db, bidOrderId);
    expect(snapshot).toMatchObject({
      quotePairsPlanned: 1,
      quotePairsPlaced: 0,
      quotePairsFailed: 1,
      bidQuotesPlaced: 1,
      askQuotesPlaced: 0,
      bidDepthAnchor: 49_000,
      askDepthAnchor: 0,
    });
  });

  it("records executable depth and stress exposure for completed pairs", async () => {
    const corporationId = new ObjectId();
    const provider = fund([corporationId]);
    const { db } = facilityDb();
    orderMocks.placeFundShareBuyOrder.mockResolvedValue({ ok: true, orderId: new ObjectId() });
    orderMocks.placeFundShareSellOrder.mockResolvedValue({ ok: true, orderId: new ObjectId() });

    const snapshot = await refreshEquityLiquidityFacility({
      db,
      turn: 62,
      enabled: true,
      funds: [provider],
      listings: [listing(corporationId)],
      totalListings: 10,
    });

    expect(snapshot).toMatchObject({
      quotePairsPlanned: 1,
      quotePairsPlaced: 1,
      quotePairsFailed: 0,
      bidQuotesPlaced: 1,
      askQuotesPlaced: 1,
      bidDepthAnchor: 49_000,
      askDepthAnchor: 51_000,
      stressLossAtRiskAnchor: 5_000,
      participatingFunds: 1,
    });
  });
});
