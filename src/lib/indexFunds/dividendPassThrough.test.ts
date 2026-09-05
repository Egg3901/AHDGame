import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  processIndexFundDividend,
  processIndexFundDividendsBatch,
} from "@/lib/indexFunds/dividendPassThrough";

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

    it("converts the ₳ dividend into the fund's currency before crediting a wallet", async () => {
      const fundId = new ObjectId();
      const corporationId = new ObjectId();
      const characterId = new ObjectId();

      db.collectionMocks["indexFunds"]!.findOne.mockResolvedValue({
        _id: fundId,
        slug: "jp50",
        name: "Nikkei 50 Index",
        tickerSymbol: "JP50",
        unitSupply: 1000,
        quotedNav: 100,
        anchorCurrencyCode: "JPY",
        cashAnchor: 0,
      });
      db.collectionMocks["indexFundPositions"]!.find.mockReturnValue(
        makeCursor([{ fundId, holderKind: "character", characterId, units: 1000 }])
      );
      db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
        _id: corporationId,
        name: "Dividend Payer Corp",
      });
      db.collectionMocks["characters"]!.find.mockReturnValue(
        makeCursor([{ _id: characterId, name: "Ren" }])
      );
      db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ forexEnabled: true });
      db.collection("gameConfig").findOne.mockResolvedValue({ forexEnabled: true });
      db.collection("exchangeRates").findOne.mockResolvedValue({
        currencyCode: "JPY",
        rate: 102.23,
      });

      await processIndexFundDividend(db as unknown as Db, fundId, 1_000_000, corporationId, 500, {
        turn: 42,
      });

      const charBulk = vi.mocked(db.collectionMocks["characters"]!.bulkWrite).mock.calls[0][0] as {
        updateOne: { update: { $inc: Record<string, number> } };
      }[];
      const paidNative = Object.values(charBulk[0].updateOne.update.$inc)[0];
      // 250,000 ₳ of pass-through at 102.23 JPY per ₳. Crediting the raw ₳ figure
      // into a yen wallet, which is what this used to do, underpaid by ~102x.
      expect(paidNative).toBeCloseTo(250_000 * 102.23, 0);
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

  /**
   * The batched path is what `corporationTurn` runs. Its correctness claim is
   * that aggregating N accruals into a handful of bulk `$inc`s lands the same
   * balances as N separate calls. These pin the arithmetic that claim rests
   * on: per-accrual flooring must happen BEFORE summation, and invalid
   * accruals must be dropped rather than poisoning a total with NaN.
   *
   * Full state-level equivalence across all six written collections is proved
   * against a real Mongo by scripts/perf/dividend-equivalence.ts, which a
   * mock-backed test cannot do.
   */
  describe("processIndexFundDividendsBatch", () => {
    let db: MockDb;
    const fundId = new ObjectId();
    const corporationId = new ObjectId();
    const characterId = new ObjectId();

    beforeEach(async () => {
      vi.clearAllMocks();
      db = createMockDb();
      for (const name of [
        "indexFunds",
        "indexFundPositions",
        "corporations",
        "characters",
        "imperialCharacters",
        "npps",
        "gameState",
        "indexFundTransactions",
        "financialTxLog",
      ]) {
        db.collection(name);
      }
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      db.collectionMocks["indexFunds"]!.findOne.mockResolvedValue({
        _id: fundId,
        slug: "batch-fund",
        name: "Batch Fund",
        tickerSymbol: "BATCH",
        unitSupply: 1000,
        quotedNav: 100,
        anchorCurrencyCode: "USD",
        cashAnchor: 0,
      });
      db.collectionMocks["indexFundPositions"]!.find.mockReturnValue(
        makeCursor([
          { _id: new ObjectId(), fundId, holderKind: "character", characterId, units: 1000 },
        ])
      );
      db.collectionMocks["corporations"]!.find.mockReturnValue(
        makeCursor([{ _id: corporationId, name: "Payer Corp" }])
      );
      db.collectionMocks["characters"]!.find.mockReturnValue(
        makeCursor([{ _id: characterId, name: "Batch Holder" }])
      );
      db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ forexEnabled: false });
    });

    /**
     * Total of every `$inc` the batch issued against a collection, summed
     * across fields. Deliberately field-agnostic: the balance field depends
     * on whether forex is on (`cashOnHand` vs
     * `currencyBalances.personal.<CCY>`), and what these tests pin is the
     * amount credited, not where it is stored.
     */
    function totalInc(collection: string): number {
      const calls = db.collectionMocks[collection]!.bulkWrite.mock.calls;
      let sum = 0;
      for (const [ops] of calls) {
        for (const op of ops as { updateOne?: { update?: { $inc?: Record<string, number> } } }[]) {
          for (const value of Object.values(op.updateOne?.update?.$inc ?? {})) {
            if (typeof value === "number") sum += value;
          }
        }
      }
      return sum;
    }

    it("sums repeated accruals to the same total as separate calls", async () => {
      const accruals = Array.from({ length: 5 }, () => ({
        fundId,
        corporationId,
        amountAnchor: 1_000_000,
        shares: 500,
      }));

      await processIndexFundDividendsBatch(db as unknown as Db, accruals, { turn: 42 });

      // 5 x 1,000,000 gross => 5 x 750,000 reinvested, 5 x 250,000 passed through.
      const fundCalls = db.collectionMocks["indexFunds"]!.bulkWrite.mock.calls;
      let fundCash = 0;
      for (const [ops] of fundCalls) {
        for (const op of ops as { updateOne?: { update?: { $inc?: Record<string, number> } } }[]) {
          fundCash += op.updateOne?.update?.$inc?.cashAnchor ?? 0;
        }
      }
      expect(fundCash).toBe(3_750_000);
      // The sole holder owns the whole float, so it takes the entire 25%.
      expect(totalInc("characters")).toBe(1_250_000);
    });

    it("floors each accrual to 2dp before summing, not after", async () => {
      // 40 x 0.004 is 0.16 in total but zero once each is floored to a cent
      // first. Summing before flooring would credit a sixth of a cent.
      const accruals = Array.from({ length: 40 }, () => ({
        fundId,
        corporationId,
        amountAnchor: 0.004,
        shares: 1,
      }));

      await processIndexFundDividendsBatch(db as unknown as Db, accruals, { turn: 42 });

      expect(totalInc("characters")).toBe(0);
    });

    it("drops non-finite and non-positive accruals instead of poisoning totals", async () => {
      const accruals = [
        { fundId, corporationId, amountAnchor: 1_000_000, shares: 500 },
        { fundId, corporationId, amountAnchor: Number.NaN, shares: 500 },
        { fundId, corporationId, amountAnchor: Number.POSITIVE_INFINITY, shares: 500 },
        { fundId, corporationId, amountAnchor: 0, shares: 500 },
        { fundId, corporationId, amountAnchor: -5_000, shares: 500 },
      ];

      await processIndexFundDividendsBatch(db as unknown as Db, accruals, { turn: 42 });

      const credited = totalInc("characters");
      expect(Number.isFinite(credited)).toBe(true);
      expect(credited).toBe(250_000);
    });

    it("writes nothing at all when every accrual is invalid", async () => {
      await processIndexFundDividendsBatch(
        db as unknown as Db,
        [{ fundId, corporationId, amountAnchor: 0, shares: 1 }],
        { turn: 42 }
      );

      expect(db.collectionMocks["indexFunds"]!.bulkWrite).not.toHaveBeenCalled();
      expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    });

    it("keeps per-corporation transaction granularity across the batch", async () => {
      const otherCorp = new ObjectId();
      db.collectionMocks["corporations"]!.find.mockReturnValue(
        makeCursor([
          { _id: corporationId, name: "Payer Corp" },
          { _id: otherCorp, name: "Other Corp" },
        ])
      );

      await processIndexFundDividendsBatch(
        db as unknown as Db,
        [
          { fundId, corporationId, amountAnchor: 1_000_000, shares: 500 },
          { fundId, corporationId: otherCorp, amountAnchor: 2_000_000, shares: 900 },
        ],
        { turn: 42 }
      );

      const inserted = db.collectionMocks["indexFundTransactions"]!.insertMany.mock.calls.flatMap(
        ([docs]) => docs as { corporationId?: ObjectId }[]
      );
      // Two rows per accrual (reinvest + pass-through), attributed per corp.
      expect(inserted.length).toBe(4);
      const byCorp = new Set(inserted.map((d) => d.corporationId?.toString()));
      expect(byCorp).toEqual(new Set([corporationId.toString(), otherCorp.toString()]));
    });
  });
});
