import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  pendingEquityPlacementBudget,
  planEquityUnderwriting,
  prepareEquityPrimaryPlacement,
} from "./primaryMarket";

describe("planEquityUnderwriting", () => {
  it("commits twenty percent of the pool's M2-sized equity allocation", () => {
    const plan = planEquityUnderwriting({
      requestedShares: 20_000,
      poolCashLocal: 100_000,
      poolM2Local: 1_000_000,
      pricePerShareLocal: 1,
    });
    expect(plan).toMatchObject({ placedShares: 10_000, unsoldShares: 10_000, fillRatio: 0.5 });
  });

  it("fully places a small issue", () => {
    expect(
      planEquityUnderwriting({
        requestedShares: 100,
        poolCashLocal: 10_000,
        pricePerShareLocal: 2,
      })
    ).toMatchObject({ placedShares: 100, unsoldShares: 0, fillRatio: 1 });
  });

  it("reserves real pool cash for the placed tranche", async () => {
    const db = createMockDb();
    db.collection("equityMarketPools");
    db.collectionMocks.equityMarketPools.findOne.mockResolvedValue({
      cashLocal: 100_000,
      targetCashLocal: 50_000,
      m2Local: 1_000_000,
    });
    db.collectionMocks.equityMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 90_000 });
    const placement = await prepareEquityPrimaryPlacement(
      db as unknown as Db,
      { countryId: "US", liquidCurrencyCode: "USD" },
      20_000,
      1,
      new Date()
    );
    expect(placement).toMatchObject({
      poolActive: true,
      placedShares: 10_000,
      unsoldShares: 10_000,
      paidLocal: 10_000,
    });
  });
});

describe("pendingEquityPlacementBudget", () => {
  it("spends ten percent of cash above half-target reserve", () => {
    expect(pendingEquityPlacementBudget(150_000, 100_000)).toBe(10_000);
    expect(pendingEquityPlacementBudget(40_000, 100_000)).toBe(0);
  });
});
