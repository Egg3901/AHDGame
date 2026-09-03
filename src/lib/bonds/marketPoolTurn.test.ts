import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));
vi.mock("@/lib/sovereignDefault/marketDemand", () => ({
  computeMarketDemand: vi.fn(),
}));

import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";
import {
  countriesForCurrency,
  planPoolCashMoves,
  processBondMarketPoolTurn,
} from "./marketPoolTurn";

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("bondMarketPools");
  db.collection("moneySupplySnapshots");
});

describe("planPoolCashMoves", () => {
  it("lets two percent of the shortfall in when short", () => {
    expect(planPoolCashMoves({ cashLocal: 50, targetCashLocal: 100 })).toEqual({
      inflow: 1,
      sweep: 0,
    });
  });
  it("sweeps down to 1.5x target when past 2x", () => {
    expect(planPoolCashMoves({ cashLocal: 300, targetCashLocal: 100 })).toEqual({
      inflow: 0,
      sweep: 150,
    });
  });
  it("does nothing between target and 2x target, or without a target", () => {
    expect(planPoolCashMoves({ cashLocal: 150, targetCashLocal: 100 })).toEqual({
      inflow: 0,
      sweep: 0,
    });
    expect(planPoolCashMoves({ cashLocal: 150, targetCashLocal: 0 })).toEqual({
      inflow: 0,
      sweep: 0,
    });
  });
});

describe("countriesForCurrency", () => {
  it("maps a currency back to its issuer countries", () => {
    expect(countriesForCurrency("GBP")).toContain("UK");
    expect(countriesForCurrency("USD")).toContain("US");
  });
});

describe("processBondMarketPoolTurn", () => {
  it("re-sizes the target from M2, lets cash flow in, and stores sovereign appetite", async () => {
    db.collectionMocks.bondMarketPools.find.mockReturnValue({
      toArray: async () => [{ _id: "GBP", cashLocal: 100, targetCashLocal: 5 }],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "GBP", m2: 10_000, turn: 583 }],
    });
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({ countryCode: "UK" } as never);
    vi.mocked(computeMarketDemand).mockReturnValue({ demandRatio: 0.7321, components: [] });

    const result = await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());

    // Target becomes 5% of 10,000 = 500; shortfall 400 -> inflow 8.
    expect(result.inflowLocalByCurrency.GBP).toBe(8);
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "GBP" },
      expect.objectContaining({
        $inc: expect.objectContaining({ cashLocal: 8, "lifetime.inflowIn": 8 }),
      }),
      expect.anything()
    );
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenLastCalledWith(
      { _id: "GBP" },
      expect.objectContaining({
        $set: expect.objectContaining({
          targetCashLocal: 500,
          appetiteByCountry: expect.objectContaining({ UK: 0.732 }),
          lastTurn: 584,
        }),
      })
    );
    expect(result.appetitesRefreshed).toBeGreaterThan(0);
  });

  it("sweeps hoarded cash back out", async () => {
    db.collectionMocks.bondMarketPools.find.mockReturnValue({
      toArray: async () => [{ _id: "GBP", cashLocal: 3_000, targetCashLocal: 500 }],
    });
    db.collectionMocks.moneySupplySnapshots.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 750 });
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue(null);

    const result = await processBondMarketPoolTurn(db as unknown as Db, 584, new Date());

    expect(result.sweptLocalByCurrency.GBP).toBe(2_250);
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "GBP", cashLocal: { $gte: 2_250 } },
      expect.objectContaining({ $inc: { cashLocal: -2_250, "lifetime.sweepOut": 2_250 } }),
      expect.anything()
    );
  });

  it("is a no-op with no pools", async () => {
    const result = await processBondMarketPoolTurn(db as unknown as Db, 1, new Date());
    expect(result.poolsProcessed).toBe(0);
  });
});
