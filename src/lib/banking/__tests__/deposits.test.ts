import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter } from "@/lib/db/types/bank";
import {
  NPC_DEPOSIT_BASE_SHARE,
  NPC_DEPOSIT_MAX_SHARE_PER_BANK,
  NPC_DEPOSIT_MAX_TOTAL_SHARE,
  computeNpcDepositShare,
  equityCappedDepositCeiling,
} from "../deposits";
import { isBlockedBorrower, isBlockedDepositor } from "../blacklist";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeActiveRetailCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    depositOffset: 0,
    lendingOffset: 1,
    blacklist: {},
    ...overrides,
  };
}

describe("banking deposits", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("corporations");
    db.collection("characters");
    db.collection("corporateSectors");
    db.collection("gameState");

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
    });
    // Room for deposits: large financial capacity so existing move tests pass.
    db.collectionMocks.corporateSectors!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ capitalStock: 250_000, sectorType: "financial" }]),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 0 }]),
    });
  });

  async function importDeposits() {
    return import("../deposits");
  }

  describe("moveCharacterSavings", () => {
    it("is pointer-only: updateOne $set touches only savingsHolder.<CODE>", async () => {
      const characterId = new ObjectId();
      const bankId = new ObjectId();
      const savingsBalance = 12_345.67;

      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: bankId,
        bankCharter: makeActiveRetailCharter({ currency: "USD" }),
      });
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: characterId,
        currencyBalances: {
          campaign: 0,
          personal: {},
          savings: { USD: savingsBalance },
        },
      });
      db.collectionMocks.characters!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { moveCharacterSavings } = await importDeposits();
      const result = await moveCharacterSavings(
        db as unknown as Db,
        characterId,
        "USD",
        bankId.toString()
      );
      expect(result).toEqual({ ok: true, holder: bankId.toString() });

      const [filter, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: characterId });
      expect(update.$set).toEqual({
        "currencyBalances.savingsHolder.USD": bankId.toString(),
        updatedAt: expect.any(Date),
      });
      const setKeys = Object.keys(update.$set);
      expect(setKeys).toEqual(
        expect.arrayContaining(["currencyBalances.savingsHolder.USD", "updatedAt"])
      );
      expect(setKeys).toHaveLength(2);
      expect(setKeys.some((k) => k.includes("savings.") || k.endsWith(".savings"))).toBe(false);
      expect(update.$inc).toBeUndefined();
      // Balance number was never part of the write
      expect(JSON.stringify(update)).not.toContain(String(savingsBalance));
    });

    it("rejects an investment charter as a depositor target", async () => {
      const characterId = new ObjectId();
      const bankId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: bankId,
        bankCharter: makeActiveRetailCharter({ type: "investment" }),
      });

      const { moveCharacterSavings } = await importDeposits();
      const result = await moveCharacterSavings(
        db as unknown as Db,
        characterId,
        "USD",
        bankId.toString()
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/retail or universal/i);
      expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    });

    it("rejects a blacklisted character depositor", async () => {
      const characterId = new ObjectId();
      const bankId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: bankId,
        bankCharter: makeActiveRetailCharter({
          blacklist: { characterIds: [characterId.toString()] },
        }),
      });

      const { moveCharacterSavings } = await importDeposits();
      const result = await moveCharacterSavings(
        db as unknown as Db,
        characterId,
        "USD",
        bankId.toString()
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/blacklist/i);
    });

    it("allows moving to centralBank even with zero savings balance", async () => {
      const characterId = new ObjectId();
      db.collectionMocks.characters!.findOne.mockResolvedValue({ _id: characterId });
      db.collectionMocks.characters!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { moveCharacterSavings } = await importDeposits();
      const result = await moveCharacterSavings(
        db as unknown as Db,
        characterId,
        "GBP",
        "centralBank"
      );
      expect(result).toEqual({ ok: true, holder: "centralBank" });
      const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
      expect(update.$set["currencyBalances.savingsHolder.GBP"]).toBe("centralBank");
    });
  });

  describe("blacklist helpers", () => {
    it("isBlockedDepositor blocks a named character only", () => {
      const characterId = new ObjectId().toString();
      const charter = makeActiveRetailCharter({
        blacklist: {
          characterIds: [characterId],
          corporationIds: [new ObjectId().toString()],
          indexFundIds: ["us_top_25"],
        },
      });
      expect(isBlockedDepositor(charter, characterId)).toBe(true);
      expect(isBlockedDepositor(charter, new ObjectId().toString())).toBe(false);
    });

    it("index-fund blacklist blocks a constituent corporation borrower", () => {
      const constituentId = new ObjectId().toString();
      const otherCorpId = new ObjectId().toString();
      const charter = makeActiveRetailCharter({
        blacklist: { indexFundIds: ["us_top_25"] },
      });
      const resolve = (fundId: string) => (fundId === "us_top_25" ? [constituentId] : []);

      expect(isBlockedBorrower(charter, { corporationId: constituentId }, resolve)).toBe(true);
      expect(isBlockedBorrower(charter, { corporationId: otherCorpId }, resolve)).toBe(false);
    });
  });

  describe("computeNpcDepositShare", () => {
    it("gives the base share at zero premium over CB APY", () => {
      const [row] = computeNpcDepositShare([{ bankId: "a", effectiveDepositRatePercent: 2 }], 2);
      expect(row.share).toBeCloseTo(NPC_DEPOSIT_BASE_SHARE, 10);
    });

    it("shrinks share when deposit rate is below CB APY", () => {
      const [row] = computeNpcDepositShare([{ bankId: "a", effectiveDepositRatePercent: 1 }], 2);
      expect(row.share).toBeLessThan(NPC_DEPOSIT_BASE_SHARE);
      expect(row.share).toBeGreaterThanOrEqual(0);
    });

    it("scales multi-bank shares so the total never exceeds 0.6", () => {
      // Force each bank toward the per-bank cap so raw sum >> 0.6.
      const banks = Array.from({ length: 8 }, (_, i) => ({
        bankId: `b${i}`,
        effectiveDepositRatePercent: 50,
      }));
      const shares = computeNpcDepositShare(banks, 1);
      const total = shares.reduce((sum, row) => sum + row.share, 0);
      expect(total).toBeCloseTo(NPC_DEPOSIT_MAX_TOTAL_SHARE, 10);
      for (const row of shares) {
        expect(row.share).toBeGreaterThanOrEqual(0);
        expect(row.share).toBeLessThanOrEqual(NPC_DEPOSIT_MAX_SHARE_PER_BANK + 1e-12);
      }
    });

    it("never returns a negative share or a share above the per-bank cap", () => {
      const cases = [
        { rate: -100, apy: 5 },
        { rate: 0, apy: 0 },
        { rate: 100, apy: 0.01 },
        { rate: 5, apy: 5 },
      ];
      for (const { rate, apy } of cases) {
        const [row] = computeNpcDepositShare(
          [{ bankId: "x", effectiveDepositRatePercent: rate }],
          apy
        );
        expect(row.share).toBeGreaterThanOrEqual(0);
        expect(row.share).toBeLessThanOrEqual(NPC_DEPOSIT_MAX_SHARE_PER_BANK);
      }
    });
  });

  describe("equityCappedDepositCeiling", () => {
    it("leaves a well-capitalized bank's ceiling untouched", () => {
      // Equity x 12 is far above the capacity ceiling: the capacity limit binds.
      expect(equityCappedDepositCeiling(1_000_000, 500_000)).toBe(1_000_000);
    });

    it("caps the ceiling at 12x equity when equity is the binding limit", () => {
      expect(equityCappedDepositCeiling(1_000_000, 50_000)).toBe(600_000);
    });

    it("drives the ceiling to zero for a bank with non-positive equity", () => {
      expect(equityCappedDepositCeiling(1_000_000, 0)).toBe(0);
      expect(equityCappedDepositCeiling(1_000_000, -167_000_000)).toBe(0);
    });

    it("matches the live-bank picture at the time of the fix", () => {
      // Solvent French banks keep their multi-billion ceilings; the two
      // negative-equity banks (Hagemeyer, The Money Printer) are pinned to 0.
      expect(equityCappedDepositCeiling(12_274_670_057, 2_270_000_000)).toBe(12_274_670_057);
      expect(equityCappedDepositCeiling(12_772_441_384, 4_710_000_000)).toBe(12_772_441_384);
      expect(equityCappedDepositCeiling(7_585_266_109, -157_000_000)).toBe(0); // Hagemeyer
      expect(equityCappedDepositCeiling(1_165_722_294, -167_000_000)).toBe(0); // The Money Printer
    });

    it("clamps non-finite inputs to a safe number", () => {
      expect(equityCappedDepositCeiling(Number.NaN, 100)).toBe(0);
      expect(equityCappedDepositCeiling(1_000, Number.NaN)).toBe(0);
      expect(equityCappedDepositCeiling(-5, 100)).toBe(0);
    });
  });
});
