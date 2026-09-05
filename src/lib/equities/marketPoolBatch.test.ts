import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { creditEquityPoolsBatch } from "@/lib/equities/marketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * corporationTurn used to credit these one accrual at a time, each preceded by
 * its own existence check, against a collection with one document per
 * currency. The batch collapses that to one read and one bulk write. These
 * pin the properties that make the two equivalent.
 */

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

describe("creditEquityPoolsBatch", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("equityMarketPools");
    db.collectionMocks["equityMarketPools"]!.find.mockReturnValue(
      makeCursor([{ _id: "USD" }, { _id: "GBP" }])
    );
  });

  /** The $inc issued for one currency, across every bulkWrite op. */
  function incFor(currency: string, field = "cashLocal"): number {
    const calls = db.collectionMocks["equityMarketPools"]!.bulkWrite.mock.calls;
    let sum = 0;
    for (const [ops] of calls) {
      for (const op of ops as {
        updateOne?: { filter?: { _id?: string }; update?: { $inc?: Record<string, number> } };
      }[]) {
        if (op.updateOne?.filter?._id !== currency) continue;
        sum += op.updateOne?.update?.$inc?.[field] ?? 0;
      }
    }
    return sum;
  }

  const accrual = (currency: string, amountLocal: number) => ({
    currency: currency as CurrencyCode,
    amountLocal,
  });

  it("sums accruals per currency and writes each pool once", async () => {
    await creditEquityPoolsBatch(
      db as unknown as Db,
      [accrual("USD", 100), accrual("USD", 250.5), accrual("GBP", 40)],
      "dividendsIn"
    );

    expect(incFor("USD")).toBeCloseTo(350.5, 6);
    expect(incFor("GBP")).toBeCloseTo(40, 6);
    // One bulkWrite, one op per currency — not one per accrual.
    const [ops] = db.collectionMocks["equityMarketPools"]!.bulkWrite.mock.calls[0]!;
    expect((ops as unknown[]).length).toBe(2);
  });

  it("moves the lifetime counter by the same total as the cash", async () => {
    await creditEquityPoolsBatch(
      db as unknown as Db,
      [accrual("USD", 10), accrual("USD", 5)],
      "dividendsIn"
    );

    expect(incFor("USD", "lifetime.dividendsIn")).toBeCloseTo(incFor("USD"), 6);
  });

  it("rounds each accrual before summing, as the per-call path did", async () => {
    // 100 x 0.004 rounds to nothing per accrual. Summing first would credit
    // 0.40 that the per-accrual path never credited.
    await creditEquityPoolsBatch(
      db as unknown as Db,
      Array.from({ length: 100 }, () => accrual("USD", 0.004)),
      "dividendsIn"
    );

    expect(db.collectionMocks["equityMarketPools"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("drops non-finite and non-positive amounts", async () => {
    await creditEquityPoolsBatch(
      db as unknown as Db,
      [
        accrual("USD", 100),
        accrual("USD", Number.NaN),
        accrual("USD", Number.POSITIVE_INFINITY),
        accrual("USD", 0),
        accrual("USD", -50),
      ],
      "dividendsIn"
    );

    expect(incFor("USD")).toBe(100);
  });

  it("skips currencies with no pool instead of upserting one mid-turn", async () => {
    await creditEquityPoolsBatch(
      db as unknown as Db,
      [accrual("USD", 100), accrual("JPY", 999)],
      "dividendsIn"
    );

    expect(incFor("USD")).toBe(100);
    expect(incFor("JPY")).toBe(0);
  });

  it("issues no read and no write when there is nothing to credit", async () => {
    await creditEquityPoolsBatch(db as unknown as Db, [], "dividendsIn");

    expect(db.collectionMocks["equityMarketPools"]!.find).not.toHaveBeenCalled();
    expect(db.collectionMocks["equityMarketPools"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("reads the pools it needs in a single query", async () => {
    await creditEquityPoolsBatch(
      db as unknown as Db,
      [accrual("USD", 1), accrual("GBP", 1), accrual("USD", 1)],
      "dividendsIn"
    );

    expect(db.collectionMocks["equityMarketPools"]!.find).toHaveBeenCalledTimes(1);
    const [filter] = db.collectionMocks["equityMarketPools"]!.find.mock.calls[0]!;
    expect(filter).toEqual({ _id: { $in: ["USD", "GBP"] } });
  });
});
