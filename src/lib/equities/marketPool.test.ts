import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  creditEquityPool,
  debitEquityPoolGated,
  equityPoolCurrency,
  loadEquityQuote,
  refundEquityPoolDebit,
} from "./marketPool";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("equityMarketPools");
});

describe("equity market pool", () => {
  it("resolves the issuer currency", () => {
    expect(equityPoolCurrency({ liquidCurrencyCode: "JPY", countryId: "US" })).toBe("JPY");
    expect(equityPoolCurrency({ countryId: "UK" })).toBe("GBP");
  });

  it("credits purchases and gates sales on real cash", async () => {
    const now = new Date("2026-09-03T00:00:00Z");
    await creditEquityPool(db as unknown as Db, "USD", 12.345, "purchasesIn", now);
    expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      expect.objectContaining({
        $inc: { cashLocal: 12.35, "lifetime.purchasesIn": 12.35 },
      }),
      { upsert: true }
    );

    db.collectionMocks.equityMarketPools.findOneAndUpdate.mockResolvedValueOnce({ cashLocal: 5 });
    expect(await debitEquityPoolGated(db as unknown as Db, "USD", 7, "salesOut", now)).toEqual({
      ok: true,
      cashAfter: 5,
    });
    expect(db.collectionMocks.equityMarketPools.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "USD", cashLocal: { $gte: 7 } },
      expect.objectContaining({ $inc: { cashLocal: -7, "lifetime.salesOut": 7 } }),
      expect.anything()
    );
  });

  it("refunds a failed downstream settlement", async () => {
    const now = new Date();
    await refundEquityPoolDebit(db as unknown as Db, "GBP", 25, "salesOut", now);
    expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenCalledWith(
      { _id: "GBP" },
      { $inc: { cashLocal: 25, "lifetime.salesOut": -25 }, $set: { updatedAt: now } },
      undefined
    );
  });

  it("returns executable bid, ask, and whole-share depth", async () => {
    db.collectionMocks.equityMarketPools.findOne.mockResolvedValueOnce({
      cashLocal: 980,
      targetCashLocal: 980,
    });
    const quote = await loadEquityQuote(
      db as unknown as Db,
      {
        countryId: "US",
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        fundamentalSharePrice: 10,
        publicFloat: 80,
        totalShares: 100,
      } as never
    );
    expect(quote).toMatchObject({ active: true, bidPriceLocal: 9.8, askPriceLocal: 10.2 });
    expect(quote.bidDepthShares).toBe(100);
    expect(quote.askDepthShares).toBe(80);
  });
});
