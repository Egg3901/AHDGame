// src/lib/currency/spreadFees.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { calculateSpreadFee, distributeSpreadFee } from "./spreadFees";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("calculateSpreadFee", () => {
  it("calculates spread amount from trade amount and spread rate", async () => {
    // 10,000 USD at 0.275% spread = 27.50 → rounded to 28
    expect(calculateSpreadFee(10_000, 0.00275)).toBe(28);
  });

  it("returns 0 for zero amount", async () => {
    expect(calculateSpreadFee(0, 0.00275)).toBe(0);
  });
});

describe("distributeSpreadFee", () => {
  it("splits 25% destroy / 25% forexRevenue / 50% collected-currency reserves", async () => {
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

  it("enlists every central-bank write in the supplied transaction session", async () => {
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const session = { id: "fee-session" };

    await distributeSpreadFee(db as unknown as Db, 100, "US", "USD", "JP", {
      session: session as never,
    });

    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledTimes(2);
    for (const call of db.collectionMocks.centralBanks.updateOne.mock.calls) {
      expect(call[2]).toEqual({ upsert: true, session });
    }
  });

  it("reverses a completed revenue leg when the reserve leg fails without a transaction", async () => {
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockRejectedValueOnce(new Error("reserve write failed"))
      .mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(distributeSpreadFee(db as unknown as Db, 100, "US", "USD", "JP")).rejects.toThrow(
      "reserve write failed"
    );
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenLastCalledWith(
      { _id: "US" },
      { $inc: { forexRevenue: -25 } }
    );
  });

  it("surfaces an uncertain state when partial-fee compensation also fails", async () => {
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockRejectedValueOnce(new Error("reserve write failed"))
      .mockRejectedValueOnce(new Error("revenue reversal failed"));

    const error = await distributeSpreadFee(db as unknown as Db, 100, "US", "USD", "JP").catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "reserve write failed" }),
      expect.objectContaining({ message: "revenue reversal failed" }),
    ]);
  });

  it("uses a single home-currency write when destination is omitted (legacy)", async () => {
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
