import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { processIndexFundDividend } from "@/lib/indexFunds/dividendPassThrough";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("dividendPassThrough", () => {
  describe("splitIndexFundDividend integration", () => {
    it("splits correctly at 75/25", async () => {
      const { splitIndexFundDividend } = await import("@/lib/indexFunds/unitAccounting");
      const result = splitIndexFundDividend(1_000_000);
      expect(result.grossAnchor).toBe(1_000_000);
      expect(result.reinvestAnchor).toBe(750_000);
      expect(result.passThroughAnchor).toBe(250_000);
    });

    it("handles zero and negative inputs", async () => {
      const { splitIndexFundDividend } = await import("@/lib/indexFunds/unitAccounting");
      const zeroResult = splitIndexFundDividend(0);
      expect(zeroResult.grossAnchor).toBe(0);
      expect(zeroResult.reinvestAnchor).toBe(0);
      expect(zeroResult.passThroughAnchor).toBe(0);

      const negResult = splitIndexFundDividend(-100);
      expect(negResult.grossAnchor).toBe(0);
    });

    it("is idempotent for repeated calls", async () => {
      const { splitIndexFundDividend } = await import("@/lib/indexFunds/unitAccounting");
      const a = splitIndexFundDividend(55_555_555);
      const b = splitIndexFundDividend(55_555_555);
      expect(a.reinvestAnchor).toBe(b.reinvestAnchor);
      expect(a.passThroughAnchor).toBe(b.passThroughAnchor);
    });
  });

  describe("processIndexFundDividend", () => {
    let db: MockDb;

    beforeEach(async () => {
      vi.clearAllMocks();
      db = createMockDb();
      for (const name of [
        "indexFunds",
        "indexFundPositions",
        "corporations",
        "characters",
        "gameState",
        "indexFundTransactions",
        "financialTxLog",
      ]) {
        db.collection(name);
      }
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    });

    it("reinvests 75% to fund cash and passes through 25% to holders", async () => {
      const fundId = new ObjectId();
      const corporationId = new ObjectId();
      const characterId = new ObjectId();

      db.collectionMocks["indexFunds"]!.findOne.mockResolvedValue({
        _id: fundId,
        slug: "test-fund",
        name: "Test Fund",
        tickerSymbol: "TEST",
        unitSupply: 1000,
        quotedNav: 100,
        anchorCurrencyCode: "USD",
        cashAnchor: 0,
      });
      db.collectionMocks["indexFundPositions"]!.find.mockReturnValue(
        makeCursor([
          {
            _id: new ObjectId(),
            fundId,
            holderKind: "character",
            characterId,
            units: 1000,
          },
        ])
      );
      db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
        _id: corporationId,
        name: "Dividend Payer Corp",
      });
      db.collectionMocks["characters"]!.find.mockReturnValue(
        makeCursor([{ _id: characterId, name: "Test Holder" }])
      );
      db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ forexEnabled: false });

      const result = await processIndexFundDividend(
        db as unknown as Db,
        fundId,
        1_000_000,
        corporationId,
        500,
        { turn: 42 }
      );

      expect(result.totalGrossAnchor).toBe(1_000_000);
      expect(result.reinvestedAnchor).toBe(750_000);
      expect(result.passedThroughAnchor).toBe(250_000);
      expect(result.holdersPaid).toBe(1);

      const fundUpdates = vi.mocked(db.collectionMocks["indexFunds"]!.updateOne).mock.calls;
      const reinvestUpdate = fundUpdates.find((call) => {
        const update = call[1] as { $inc?: { cashAnchor?: number } };
        return update?.$inc?.cashAnchor === 750_000;
      });
      expect(reinvestUpdate).toBeDefined();

      expect(db.collectionMocks["characters"]!.bulkWrite).toHaveBeenCalled();
      const charBulk = vi.mocked(db.collectionMocks["characters"]!.bulkWrite).mock.calls[0][0] as {
        updateOne: {
          filter: { _id: ObjectId };
          update: { $inc: Record<string, number>; $set: { updatedAt: Date } };
        };
      }[];
      expect(charBulk[0].updateOne.filter._id.toString()).toBe(characterId.toString());
      // forex is always on — dividend pass-through writes to personal currency balance
      const incFields = charBulk[0].updateOne.update.$inc;
      const paidAmount = Object.values(incFields)[0];
      expect(paidAmount).toBe(250_000);

      expect(db.collectionMocks["indexFundTransactions"]!.insertOne).toHaveBeenCalledTimes(2);
    });

    it("returns zero distribution when fund has no unit supply", async () => {
      const fundId = new ObjectId();
      const corporationId = new ObjectId();

      db.collectionMocks["indexFunds"]!.findOne.mockResolvedValue({
        _id: fundId,
        slug: "empty-fund",
        name: "Empty Fund",
        tickerSymbol: "EMPTY",
        unitSupply: 0,
        quotedNav: 100,
        anchorCurrencyCode: "USD",
        cashAnchor: 0,
      });

      const result = await processIndexFundDividend(
        db as unknown as Db,
        fundId,
        1_000_000,
        corporationId,
        500,
        { turn: 42 }
      );

      expect(result.totalGrossAnchor).toBe(1_000_000);
      expect(result.reinvestedAnchor).toBe(750_000);
      expect(result.passedThroughAnchor).toBe(250_000);
      expect(result.holdersPaid).toBe(0);
      expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    });
  });
});
