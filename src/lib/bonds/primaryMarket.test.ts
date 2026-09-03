import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return {
    ...actual,
    loadBondQuote: vi.fn(),
  };
});

import { loadBondQuote } from "@/lib/bonds/marketPool";
import {
  placeUnsoldBondUnits,
  planCorporateUnderwriting,
  planSovereignMonetization,
  planSovereignUnderwriting,
  unsoldPlacementBudget,
  unsoldPlacementCap,
} from "./primaryMarket";

describe("planCorporateUnderwriting", () => {
  it("writes a slice of the liquidity cash scaled by credit tier", () => {
    // Liquidity cash = min(pool cash 100k, 5% of M2 1M = 50k) = 50k; 20% commit = 10k;
    // BBB factor 0.75 -> 7.5k -> 7 units at 1,000.
    const plan = planCorporateUnderwriting({
      requestedUnits: 20,
      poolCashLocal: 100_000,
      poolM2Local: 1_000_000,
      rating: "BBB",
      pricePerUnitLocal: 1_000,
    });
    expect(plan).toMatchObject({ placedUnits: 7, unsoldUnits: 13, fillRatio: 0.35 });
  });

  it("fills a small issue completely", () => {
    const plan = planCorporateUnderwriting({
      requestedUnits: 3,
      poolCashLocal: 100_000,
      poolM2Local: 1_000_000,
      rating: "AAA",
      pricePerUnitLocal: 1_000,
    });
    expect(plan).toMatchObject({ placedUnits: 3, unsoldUnits: 0, fillRatio: 1 });
  });
});

describe("planSovereignUnderwriting", () => {
  it("commits most of the pool at neutral appetite and less as appetite falls", () => {
    const strong = planSovereignUnderwriting({
      requestedUnits: 1_000,
      poolCashLocal: 1_000_000,
      appetite: 1.2,
      pricePerUnitLocal: 1_000,
    });
    const weak = planSovereignUnderwriting({
      requestedUnits: 1_000,
      poolCashLocal: 1_000_000,
      appetite: 0.3,
      pricePerUnitLocal: 1_000,
    });
    expect(strong.placedUnits).toBe(900);
    expect(weak.placedUnits).toBe(225);
    expect(weak.fillRatio).toBe(0.225);
  });

  it("never goes below the appetite floor", () => {
    const shunned = planSovereignUnderwriting({
      requestedUnits: 1_000,
      poolCashLocal: 1_000_000,
      appetite: 0,
      pricePerUnitLocal: 1_000,
    });
    expect(shunned.placedUnits).toBe(90);
  });
});

describe("unsoldPlacementBudget", () => {
  it("only spends cash above half the target, a tenth per turn", () => {
    expect(unsoldPlacementBudget(150_000, 100_000)).toBe(10_000);
    expect(unsoldPlacementBudget(40_000, 100_000)).toBe(0);
    expect(unsoldPlacementBudget(150_000, 0)).toBe(15_000);
  });
});

describe("unsoldPlacementCap", () => {
  it("places two percent of the requested size per turn, at least one unit", () => {
    expect(unsoldPlacementCap(1_000, 500)).toBe(20);
    expect(unsoldPlacementCap(10, 4)).toBe(1);
    expect(unsoldPlacementCap(1_000, 5)).toBe(5);
    expect(unsoldPlacementCap(1_000, 0)).toBe(0);
  });
});

describe("planSovereignMonetization", () => {
  it("caps the bank's take at a share of GDP", () => {
    expect(
      planSovereignMonetization({ unsoldUnits: 1_000, gdpLocal: 100_000, pricePerUnitLocal: 1_000 })
    ).toEqual({ units: 2, considerationLocal: 2_000 });
    expect(
      planSovereignMonetization({ unsoldUnits: 1, gdpLocal: 100_000_000, pricePerUnitLocal: 1_000 })
    ).toEqual({ units: 1, considerationLocal: 1_000 });
  });
});

describe("placeUnsoldBondUnits", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bonds");
    db.collection("bondMarketPools");
  });

  it("places up to the per-turn cap within the pool's placement budget and reports proceeds", async () => {
    const corpId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      corporationId: corpId,
      currencyCode: "USD",
      couponRate: 5,
      requestedUnits: 1_000,
      unsoldUnits: 600,
      publicFloat: 400,
      totalIssued: 400_000,
      marketPrice: 1,
      matured: false,
      defaulted: false,
    };
    db.collectionMocks.bonds.find.mockReturnValue({
      sort: () => ({ toArray: async () => [bond] }),
    });
    // Pool has 150k against no target: 10% placement budget = 15k -> 14 units at the 1,020 ask.
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue({
      cashLocal: 150_000,
      targetCashLocal: 0,
    });
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 100_000 });
    vi.mocked(loadBondQuote).mockResolvedValue({ askPerUnit: 1_020 } as never);
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const result = await placeUnsoldBondUnits(db as unknown as Db, 600, new Date());

    expect(result.unitsPlaced).toBe(14);
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledWith(
      { _id: bond._id, unsoldUnits: { $gte: 14 } },
      expect.objectContaining({
        $inc: { unsoldUnits: -14, publicFloat: 14, totalIssued: 14_000 },
      })
    );
    expect(result.corporateProceedsByCorp.get(corpId.toString())).toEqual({
      local: 14_280,
      currency: "USD",
    });
  });

  it("does nothing when the pool has no cash", async () => {
    db.collectionMocks.bonds.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            corporationId: new ObjectId(),
            currencyCode: "USD",
            requestedUnits: 100,
            unsoldUnits: 50,
            matured: false,
            defaulted: false,
            marketPrice: 1,
          },
        ],
      }),
    });
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue({ cashLocal: 0 });
    const result = await placeUnsoldBondUnits(db as unknown as Db, 1, new Date());
    expect(result.unitsPlaced).toBe(0);
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });
});
