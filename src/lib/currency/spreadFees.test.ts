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
