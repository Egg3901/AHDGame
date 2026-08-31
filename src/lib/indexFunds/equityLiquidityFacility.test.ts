import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";

const orderMocks = vi.hoisted(() => ({
  cancelFundShareOrder: vi.fn(),
  placeFundShareBuyOrder: vi.fn(),
  placeFundShareSellOrder: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundShareOrders", () => orderMocks);

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

function facilityDb(priorOrders: Array<{ _id: ObjectId }> = []): {
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
    });
    expect(plans[0].shares).toBe(1_000);
    expect(plans[0].stressLossAnchor).toBe(10_000);
  });

  it("caps participation per fund even when it holds every listing", () => {
    const ids = Array.from({ length: 40 }, () => new ObjectId());
    const provider = fund(ids);
    provider.cashAnchor = 100_000_000;
    const plans = planEquityLiquidityQuotes({
      funds: [provider],
      listings: ids.map(listing),
      totalListings: 100,
      turn: 51,
    });

    expect(plans).toHaveLength(EQUITY_LIQUIDITY_MAX_QUOTES_PER_FUND);
  });

  it("does not quote inventory the fund does not own", () => {
    const held = new ObjectId();
    const unheld = new ObjectId();
    const plans = planEquityLiquidityQuotes({
      funds: [fund([held])],
      listings: [listing(unheld)],
      totalListings: 10,
      turn: 52,
    });
    expect(plans).toEqual([]);
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

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(first[0].corporationId).toEqual(ids[0]);
    expect(second[0].corporationId).toEqual(ids[1]);
  });
});

describe("refreshEquityLiquidityFacility", () => {
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

  it("cancels bid escrow when the paired ask cannot be placed", async () => {
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

    expect(orderMocks.cancelFundShareOrder).toHaveBeenCalledWith(db, bidOrderId);
    expect(snapshot).toMatchObject({
      quotePairsPlanned: 1,
      quotePairsPlaced: 0,
      quotePairsFailed: 1,
      bidDepthAnchor: 0,
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
      bidDepthAnchor: 98_000,
      askDepthAnchor: 102_000,
      stressLossAtRiskAnchor: 10_000,
      participatingFunds: 1,
    });
  });
});
