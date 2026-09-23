import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  pendingEquityPlacementBudget,
  placePendingShareIssuances,
  planEquityUnderwriting,
  prepareEquityPrimaryPlacement,
} from "./primaryMarket";

describe("planEquityUnderwriting", () => {
  it("uses the calibrated liquidity target after an accounting reclassification", () => {
    expect(
      planEquityUnderwriting({
        requestedShares: 20000,
        poolCashLocal: 100000,
        poolM2Local: 2000,
        poolLiquidityTargetLocal: 50000,
        pricePerShareLocal: 1,
      }).placedShares
    ).toBe(10000);
  });
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
      m2Local: 2_000,
      poolAccountingVersion: 2,
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
  });

  it("preserves a fraction of attainable cash when the long-run target is out of reach", () => {
    expect(pendingEquityPlacementBudget(40_000, 100_000)).toBe(2_000);
  });
});

describe("placePendingShareIssuances", () => {
  function thinPoolDb(poolCashLocal: number) {
    const db = createMockDb();
    const corp = {
      _id: new ObjectId(),
      name: "Stalled Corp",
      countryId: "US",
      liquidCurrencyCode: "USD",
      sharePrice: 1000,
      fundamentalSharePrice: 1000,
      totalShares: 10_000_000,
      publicFloat: 1_000_000,
      pendingShareIssuance: {
        remainingShares: 100,
        requestedShares: 10_000,
        source: "direct",
        createdAtTurn: 7,
        initialPriceLocal: 1000,
      },
    };
    db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue({
      sort: () => ({ toArray: async () => [corp] }),
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("equityMarketPools");
    // Ask lands at 1020 (2% dealer spread on the 1000 execution price), so a
    // 200-per-turn budget cannot afford a single paced share.
    db.collectionMocks.equityMarketPools.findOne.mockResolvedValue({
      _id: "USD",
      cashLocal: poolCashLocal,
      targetCashLocal: 0,
    });
    db.collectionMocks.equityMarketPools.findOneAndUpdate.mockImplementation(async (filter) => {
      const needed = (filter as { cashLocal?: { $gte?: number } }).cashLocal?.$gte ?? 0;
      return poolCashLocal >= needed ? { cashLocal: poolCashLocal - needed } : null;
    });
    return { db, corp };
  }

  it("places one share per turn when the pacing budget rounds below a single share (#2114)", async () => {
    const { db } = thinPoolDb(2000);
    const result = await placePendingShareIssuances(db as unknown as Db, 42, new Date());
    expect(result).toMatchObject({ corporationsTouched: 1, sharesPlaced: 1 });
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        "pendingShareIssuance.remainingShares": { $gte: 1 },
      }),
      expect.anything()
    );
  });

  it("funds an already listed IPO share without issuing or listing it again", async () => {
    const { db, corp } = thinPoolDb(2000);
    Object.assign(corp.pendingShareIssuance, { source: "ipo", issuedUpfront: true });
    await placePendingShareIssuances(db as unknown as Db, 42, new Date());
    const pipeline = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as Array<{
      $set: Record<string, unknown>;
    }>;
    expect(pipeline[0].$set.totalShares).toBeUndefined();
    expect(pipeline[0].$set.sharePrice).toBeUndefined();
    expect(pipeline[0].$set.fundamentalSharePrice).toBeUndefined();
    expect(pipeline[0].$set.publicFloat).toBeUndefined();
  });

  it("places nothing when the pool has no placement budget at all", async () => {
    const { db } = thinPoolDb(0);
    const result = await placePendingShareIssuances(db as unknown as Db, 42, new Date());
    expect(result).toMatchObject({ corporationsTouched: 0, sharesPlaced: 0 });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("places nothing when pool cash cannot cover even one share", async () => {
    const { db } = thinPoolDb(500);
    // Budget is 50 (10% of 500) with cash below the 1020 ask: the one-share
    // floor is attempted but the gated debit refuses, so no state changes.
    const result = await placePendingShareIssuances(db as unknown as Db, 42, new Date());
    expect(result).toMatchObject({ corporationsTouched: 0, sharesPlaced: 0 });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
