import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  bondPoolCurrency,
  bondPoolDepthMessage,
  bondPoolFillableUnits,
  creditBondPool,
  debitBondPoolGated,
  debitBondPoolUpTo,
  readBondPoolCash,
  refundBondPoolDebit,
} from "./marketPool";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("bondMarketPools");
});

describe("bondPoolCurrency", () => {
  it("prefers the stamped currency, then the issuer country, then USD", () => {
    expect(bondPoolCurrency({ currencyCode: "JPY", countryId: "US" })).toBe("JPY");
    expect(bondPoolCurrency({ countryId: "UK" })).toBe("GBP");
    expect(bondPoolCurrency({})).toBe("USD");
  });
});

describe("creditBondPool", () => {
  it("upserts the pool and bumps the lifetime counter", async () => {
    const now = new Date("2026-09-03T00:00:00Z");
    await creditBondPool(db as unknown as Db, "USD", 1234.567, "purchasesIn", now);
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      {
        $inc: { cashLocal: 1234.57, "lifetime.purchasesIn": 1234.57 },
        $set: { updatedAt: now },
        $setOnInsert: { targetCashLocal: 0, createdAt: now },
      },
      { upsert: true }
    );
  });

  it("ignores zero, negative and non-finite amounts", async () => {
    await creditBondPool(db as unknown as Db, "USD", 0, "purchasesIn");
    await creditBondPool(db as unknown as Db, "USD", -5, "purchasesIn");
    await creditBondPool(db as unknown as Db, "USD", Number.NaN, "purchasesIn");
    expect(db.collectionMocks.bondMarketPools.updateOne).not.toHaveBeenCalled();
  });
});

describe("debitBondPoolGated", () => {
  it("only debits when the pool can cover the amount", async () => {
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValueOnce({ cashLocal: 50 });
    const ok = await debitBondPoolGated(db as unknown as Db, "GBP", 25, "salesOut");
    expect(ok).toEqual({ ok: true, cashAfter: 50 });
    const [filter, update] = db.collectionMocks.bondMarketPools.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: "GBP", cashLocal: { $gte: 25 } });
    expect(update.$inc).toEqual({ cashLocal: -25, "lifetime.salesOut": 25 });
  });

  it("refuses when the pool is short", async () => {
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValueOnce(null);
    const res = await debitBondPoolGated(db as unknown as Db, "GBP", 25, "salesOut");
    expect(res).toEqual({ ok: false });
  });

  it("refuses negative amounts without touching the database", async () => {
    const res = await debitBondPoolGated(db as unknown as Db, "GBP", -1, "salesOut");
    expect(res).toEqual({ ok: false });
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("refundBondPoolDebit", () => {
  it("puts the cash back and unwinds the counter", async () => {
    const now = new Date();
    await refundBondPoolDebit(db as unknown as Db, "USD", 10, "salesOut", now);
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      { $inc: { cashLocal: 10, "lifetime.salesOut": -10 }, $set: { updatedAt: now } }
    );
  });
});

describe("debitBondPoolUpTo", () => {
  it("pays what the pool has when that is less than wanted", async () => {
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValueOnce({ cashLocal: 40 });
    db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValueOnce({ cashLocal: 0 });
    const paid = await debitBondPoolUpTo(db as unknown as Db, "USD", 100, "estateOut");
    expect(paid).toBe(40);
  });

  it("pays nothing from an empty pool", async () => {
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue(null);
    const paid = await debitBondPoolUpTo(db as unknown as Db, "USD", 100, "estateOut");
    expect(paid).toBe(0);
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("readBondPoolCash", () => {
  it("treats a missing pool as empty", async () => {
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValueOnce(null);
    expect(await readBondPoolCash(db as unknown as Db, "USD")).toBe(0);
  });
});

describe("bondPoolFillableUnits", () => {
  it("floors to whole units the pool can afford", () => {
    expect(bondPoolFillableUnits(10_500, 1_000, 20)).toBe(10);
    expect(bondPoolFillableUnits(10_500, 1_000, 5)).toBe(5);
    expect(bondPoolFillableUnits(0, 1_000, 5)).toBe(0);
    expect(bondPoolFillableUnits(10_500, 0, 5)).toBe(0);
  });
});

describe("bondPoolDepthMessage", () => {
  it("names the currency and the fillable size", () => {
    expect(bondPoolDepthMessage(0, "USD")).toContain("no cash");
    expect(bondPoolDepthMessage(1234, "JPY")).toContain("1,234 units");
  });
});

describe("mock sanity", () => {
  it("uses the bondMarketPools collection", () => {
    expect(vi.isMockFunction(db.collection)).toBe(true);
  });
});
