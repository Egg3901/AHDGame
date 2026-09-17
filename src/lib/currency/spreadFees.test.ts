// src/lib/currency/spreadFees.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("calculateSpreadFee", () => {
  it("calculates spread amount from trade amount and spread rate", async () => {
    const { calculateSpreadFee } = await import("./spreadFees");
    // 10,000 USD at 0.275% spread = 27.50 → rounded to 28
    expect(calculateSpreadFee(10_000, 0.00275)).toBe(28);
  });

  it("returns 0 for zero amount", async () => {
    const { calculateSpreadFee } = await import("./spreadFees");
    expect(calculateSpreadFee(0, 0.00275)).toBe(0);
  });
});

describe("distributeSpreadFee", () => {
  it("splits 25% destroy / 25% forexRevenue / 50% collected-currency reserves", async () => {
    const { distributeSpreadFee } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await distributeSpreadFee(db as unknown as Db, 100, "US", "GBP");
    expect(result.destroyed).toBe(25);
    expect(result.toCentralBank).toBe(75);
    expect(result.toReserveBalance).toBe(50);

    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { forexRevenue: 25, "spreadFeeReserveBalances.GBP": 50 } },
      { upsert: true }
    );
  });

  it("routes the foreign reserve slice to the destination CB while forexRevenue stays at source", async () => {
    const { distributeSpreadFee } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    // USD coupon converted to JPY: collected currency USD, source US, dest JP.
    const result = await distributeSpreadFee(db as unknown as Db, 100, "US", "USD", "JP");
    expect(result.toReserveBalance).toBe(50);

    const calls = db.collectionMocks.centralBanks.updateOne.mock.calls;
    // forexRevenue (25) → source US bank, no reserve slice.
    expect(calls).toContainEqual([{ _id: "US" }, { $inc: { forexRevenue: 25 } }, { upsert: true }]);
    // reserve slice (50 USD) → destination JP bank as a foreign reserve.
    expect(calls).toContainEqual([
      { _id: "JP" },
      { $inc: { "spreadFeeReserveBalances.USD": 50 } },
      { upsert: true },
    ]);
  });

  it("uses a single home-currency write when destination is omitted (legacy)", async () => {
    const { distributeSpreadFee } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await distributeSpreadFee(db as unknown as Db, 100, "US", "USD");
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { forexRevenue: 25, "spreadFeeReserveBalances.USD": 50 } },
      { upsert: true }
    );
  });

  it("handles odd amounts so the three slices sum back to the total fee", async () => {
    const { distributeSpreadFee } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await distributeSpreadFee(db as unknown as Db, 99, "US", "USD");
    // round(99*0.5)=50 reserves, round(99*0.25)=25 forexRevenue, 75 to CB, 24 destroyed.
    expect(result.toReserveBalance).toBe(50);
    expect(result.toCentralBank).toBe(75);
    expect(result.destroyed).toBe(24);
    expect(result.destroyed + result.toCentralBank).toBe(99);
  });
});

describe("makeSpreadDistributionSteps", () => {
  it("routes one fee as guarded keyed writes with the legacy split and banks", async () => {
    const { makeSpreadDistributionSteps } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");

    const steps = makeSpreadDistributionSteps(db as unknown as Db, "fee-key-1", {
      totalFee: 100,
      sourceCountryId: "US",
      currencyCode: "USD",
      destinationCountryId: "UK",
    });
    expect(steps).toHaveLength(2);

    for (const step of steps) {
      expect(await step.apply()).toBe("applied");
    }

    const calls = db.collectionMocks.centralBanks.updateOne.mock.calls;
    // forexRevenue (25) → source US bank, guarded by the flow key.
    expect(calls).toContainEqual([
      { _id: "US", appliedMoneyFlowKeys: { $ne: "fee-key-1" } },
      expect.objectContaining({ $inc: { forexRevenue: 25 } }),
      undefined,
    ]);
    // Reserve slice (50 USD) → destination UK bank as a foreign reserve.
    expect(calls).toContainEqual([
      { _id: "UK", appliedMoneyFlowKeys: { $ne: "fee-key-1" } },
      expect.objectContaining({ $inc: { "spreadFeeReserveBalances.USD": 50 } }),
      undefined,
    ]);
  });

  it("yields no steps for a non-positive fee, mirroring the legacy no-op", async () => {
    const { makeSpreadDistributionSteps } = await import("./spreadFees");
    expect(
      makeSpreadDistributionSteps(db as unknown as Db, "fee-key-0", {
        totalFee: 0,
        sourceCountryId: "US",
        currencyCode: "USD",
        destinationCountryId: "UK",
      })
    ).toEqual([]);
  });
});

describe("makeSpreadDistributionStepsForFees", () => {
  it("merges both half-spread slices per bank into one keyed write each", async () => {
    const { makeSpreadDistributionStepsForFees } = await import("./spreadFees");
    (db as unknown as Db).collection("centralBanks");

    // A direct accept's maker (4 USD, US→UK) plus taker (3 GBP, UK→US)
    // half-spreads: each bank takes one revenue and one reserve slice.
    const steps = makeSpreadDistributionStepsForFees(db as unknown as Db, "fees-key-1", [
      { totalFee: 4, sourceCountryId: "US", currencyCode: "USD", destinationCountryId: "UK" },
      { totalFee: 3, sourceCountryId: "UK", currencyCode: "GBP", destinationCountryId: "US" },
    ]);
    // One merged step per bank — two same-bank steps would collide on the
    // `$ne: key` guard and the second slice would be silently skipped.
    expect(steps).toHaveLength(2);

    for (const step of steps) {
      expect(await step.apply()).toBe("applied");
    }

    const calls = db.collectionMocks.centralBanks.updateOne.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual([
      { _id: "US", appliedMoneyFlowKeys: { $ne: "fees-key-1" } },
      expect.objectContaining({
        $inc: { forexRevenue: 1, "spreadFeeReserveBalances.GBP": 2 },
      }),
      undefined,
    ]);
    expect(calls).toContainEqual([
      { _id: "UK", appliedMoneyFlowKeys: { $ne: "fees-key-1" } },
      expect.objectContaining({
        $inc: { forexRevenue: 1, "spreadFeeReserveBalances.USD": 2 },
      }),
      undefined,
    ]);
  });

  it("skips non-positive fees and drops zero slices like the legacy path", async () => {
    const { makeSpreadDistributionStepsForFees } = await import("./spreadFees");
    expect(
      makeSpreadDistributionStepsForFees(db as unknown as Db, "fees-key-0", [
        { totalFee: 0, sourceCountryId: "US", currencyCode: "USD", destinationCountryId: "UK" },
      ])
    ).toEqual([]);
  });
});
