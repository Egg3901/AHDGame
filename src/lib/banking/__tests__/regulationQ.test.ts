import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter } from "@/lib/db/types/bank";
import {
  HISTORICAL_DEPOSIT_CORRIDOR,
  HISTORICAL_LENDING_CORRIDOR,
  MODERN_DEPOSIT_CORRIDOR,
  MODERN_LENDING_CORRIDOR,
  clampOffsets,
} from "../regulationQ";

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

describe("regulationQ corridors", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameState");
    db.collection("bankingLaws");
    db.collection("gameConfig");
    db.collection("corporations");
    db.collection("centralBanks");

    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 10,
    });
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
    });
  });

  async function importRegulationQ() {
    return import("../regulationQ");
  }

  async function importRates() {
    return import("../rates");
  }

  it("uses modern deposit/lending defaults when era unit scale is 1", async () => {
    const { getDepositRateCorridor, getLendingRateCorridor } = await importRegulationQ();
    await expect(getDepositRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      MODERN_DEPOSIT_CORRIDOR
    );
    await expect(getLendingRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      MODERN_LENDING_CORRIDOR
    );
  });

  it("uses historical Reg-Q defaults when era unit scale > 1", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      currentTurn: 1,
    });
    const { getDepositRateCorridor, getLendingRateCorridor } = await importRegulationQ();
    await expect(getDepositRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      HISTORICAL_DEPOSIT_CORRIDOR
    );
    await expect(getLendingRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      HISTORICAL_LENDING_CORRIDOR
    );
  });

  it("prefers per-country bankingLaws corridor overrides", async () => {
    const depositOverride = { minOffset: -2, maxOffset: 0 };
    const lendingOverride = { minOffset: 1, maxOffset: 4 };
    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue({
      _id: "US",
      separation: "universal",
      enactedTurn: 1,
      depositCorridor: depositOverride,
      lendingCorridor: lendingOverride,
    });
    const { getDepositRateCorridor, getLendingRateCorridor } = await importRegulationQ();
    await expect(getDepositRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      depositOverride
    );
    await expect(getLendingRateCorridor(db as unknown as Db, "US")).resolves.toEqual(
      lendingOverride
    );
  });

  it("clampOffsets corrects out-of-band values into the corridor", () => {
    const corrected = clampOffsets(
      { depositOffset: -10, lendingOffset: 99 },
      { deposit: MODERN_DEPOSIT_CORRIDOR, lending: MODERN_LENDING_CORRIDOR }
    );
    expect(corrected.depositOffset).toBe(MODERN_DEPOSIT_CORRIDOR.minOffset);
    expect(corrected.lendingOffset).toBe(MODERN_LENDING_CORRIDOR.maxOffset);
  });

  describe("setBankRates corridor validation", () => {
    it("rejects deposit offsets outside the corridor (no silent clamp)", async () => {
      const corpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: corpId,
        bankCharter: makeActiveRetailCharter(),
      });

      const { setBankRates } = await importRates();
      // Modern deposit max is +0.5; +2.0 is out of band.
      const result = await setBankRates(db as unknown as Db, corpId, 2.0, 1.0);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/deposit offset/i);
      expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
    });

    it("rejects lending offsets outside the corridor", async () => {
      const corpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: corpId,
        bankCharter: makeActiveRetailCharter(),
      });

      const { setBankRates } = await importRates();
      const result = await setBankRates(db as unknown as Db, corpId, 0, 20);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/lending offset/i);
    });

    it("writes offsets when both are inside the modern corridor", async () => {
      const corpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: corpId,
        bankCharter: makeActiveRetailCharter(),
      });
      db.collectionMocks.corporations!.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const { setBankRates } = await importRates();
      const result = await setBankRates(db as unknown as Db, corpId, 0.25, 2.0);
      expect(result).toEqual({ ok: true, depositOffset: 0.25, lendingOffset: 2.0 });
      expect(db.collectionMocks.corporations!.updateOne).toHaveBeenCalled();
    });

    it("rejects rate-setting on an investment charter", async () => {
      const corpId = new ObjectId();
      db.collectionMocks.corporations!.findOne.mockResolvedValue({
        _id: corpId,
        bankCharter: makeActiveRetailCharter({ type: "investment", depositOffset: 0 }),
      });

      const { setBankRates } = await importRates();
      const result = await setBankRates(db as unknown as Db, corpId, -1, 1);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/investment/i);
      expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
    });
  });
});
