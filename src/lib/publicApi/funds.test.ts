import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

function fundDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    slug: "us-broad",
    name: "US Broad Market",
    tickerSymbol: "USB",
    scope: "country",
    kind: "broad",
    countryId: "US",
    status: "active",
    quotedNav: 105.5,
    unitSupply: 1_000_000,
    anchorCurrencyCode: "USD",
    backingRatio: 0.98,
    holdings: [
      {
        corporationId: new ObjectId(),
        shares: 100,
        lastValueAnchor: 500,
        avgCostPerShareAnchor: 4,
      },
      {
        corporationId: new ObjectId(),
        shares: 200,
        lastValueAnchor: 900,
        avgCostPerShareAnchor: 3,
      },
    ],
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("publicApi funds queries", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("lists funds sorted by NAV", async () => {
    const { queryIndexFunds } = await import("./funds");
    const col = db.collection("indexFunds");
    col.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([fundDoc()]),
    } as never);

    const result = await queryIndexFunds(db as unknown as Db);
    expect(result.found).toBe(true);
    const f = (result.funds as Record<string, unknown>[])[0];
    expect(f.slug).toBe("us-broad");
    expect(f.quotedNav).toBe(105.5);
    expect(f.countryId).toBe("US");
  });

  it("returns null for unknown slug detail", async () => {
    const { queryIndexFundDetail } = await import("./funds");
    db.collection("indexFunds").findOne.mockResolvedValue(null);
    const result = await queryIndexFundDetail(db as unknown as Db, "nope");
    expect(result).toBeNull();
  });

  it("detail enriches top holdings with corporation names", async () => {
    const { queryIndexFundDetail } = await import("./funds");
    const fund = fundDoc();
    db.collection("indexFunds").findOne.mockResolvedValue(fund);
    db.collection("corporations").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: (fund.holdings[1] as { corporationId: ObjectId }).corporationId, name: "BigCorp" },
        ]),
    } as never);

    const result = await queryIndexFundDetail(db as unknown as Db, "us-broad");
    if (!result || !("fund" in result)) throw new Error("expected detail");
    const f = result.fund as Record<string, unknown>;
    const holdings = f.topHoldings as Record<string, unknown>[];
    // Sorted by lastValueAnchor desc: the 900-value holding first.
    expect(holdings[0].corporationName).toBe("BigCorp");
    expect(holdings[1].corporationName).toBeNull();
  });
});
