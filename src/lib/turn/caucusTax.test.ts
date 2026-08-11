import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/utils/fundGeneration", () => ({
  projectCharacterGeneration: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: vi.fn().mockResolvedValue({}),
  emitTxBulk: vi.fn(),
}));
vi.mock("@/lib/treasury/emit", () => ({
  emitTreasuryTransaction: vi.fn(),
}));

import { getDb } from "@/lib/mongodb";
import { projectCharacterGeneration } from "@/lib/utils/fundGeneration";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import { processCaucusTax } from "./caucusTax";

describe("processCaucusTax", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.clearAllMocks();
  });

  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  it("returns zero totals when no taxed caucuses exist", async () => {
    setupCollection("caucuses", []);
    const result = await processCaucusTax(true, 100);
    expect(result).toEqual({ caucusesProcessed: 0, membersTaxed: 0, totalTaxed: 0 });
  });

  // Regression test for cf-inconsistency-fix Phase 3.2.
  // tax is derived from LOCAL income (projectCharacterGeneration returns flat USD
  // constants). Old code passed `tax` to buildCampaignFundsInc which multiplied
  // it by homeFxRate, over-debiting currencyBalances.campaign at non-1.0 rates.
  // The new local-unit helper writes `-tax` directly to currencyBalances.campaign.
  it("debits tax from LOCAL stored balance (no FX multiplication) under forex", async () => {
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "Test Caucus",
      countryId: "US",
      partyId: "1",
      disbandedAt: null,
      taxRate: 10, // 10% of income
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "Test Character",
      countryId: "US",
      homeState: "US-CA",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 999_999, // stale-high mirror, deliberately wrong
      currencyBalances: { campaign: 50_000, personal: { USD: 0 } },
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "US-CA", population: 100_000, gdp: 1_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000); // LOCAL USD

    const result = await processCaucusTax(true, 100);

    expect(result.membersTaxed).toBe(1);
    // 10% of $10,000 income = $1,000 tax, in LOCAL USD
    expect(result.totalTaxed).toBe(1_000);

    const updateCall = db.collectionMocks["characters"]!.updateOne.mock.calls[0] as
      [Record<string, unknown>, { $inc: Record<string, number> }] | undefined;
    expect(updateCall).toBeDefined();
    const [filter, update] = updateCall!;

    // $inc should write to currencyBalances.campaign in LOCAL units, NOT
    // multiplied by any FX rate, and NOT touch the legacy funds mirror.
    expect(update.$inc).toEqual({ "currencyBalances.campaign": -1_000 });
    expect(update.$inc).not.toHaveProperty("funds");

    // Filter must guard on the stored local balance (in stored units).
    expect(filter).toMatchObject({ "currencyBalances.campaign": { $gte: 1_000 } });
    expect(filter).not.toHaveProperty("funds");
  });

  it("taxes a non-USD member on frozen-local income (NG ×1550)", async () => {
    // income constants are anchor; caucus tax is a % of the LOCAL (frozen-rate)
    // income, so an NG member is taxed at the naira scale — not 1/1550th of it.
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "NG Caucus",
      countryId: "NG",
      partyId: "6",
      disbandedAt: null,
      taxRate: 10,
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "NG Character",
      countryId: "NG",
      homeState: "NG-SW",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 0,
      currencyBalances: { campaign: 50_000_000, personal: { NGN: 0 } },
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "NG-SW", population: 17_000_000, gdp: 74_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000); // anchor

    const result = await processCaucusTax(true, 100);

    const expectedTax = Math.floor((10_000 * 1550 * 10) / 100);
    expect(result.membersTaxed).toBe(1);
    expect(result.totalTaxed).toBe(expectedTax);

    const update = db.collectionMocks["characters"]!.updateOne.mock.calls[0]?.[1] as {
      $inc: Record<string, number>;
    };
    expect(update.$inc).toEqual({ "currencyBalances.campaign": -expectedTax });
  });

  it("skips members whose LOCAL stored balance is below the tax (no overdraft, no treasury credit)", async () => {
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "Test Caucus",
      countryId: "US",
      partyId: "1",
      disbandedAt: null,
      taxRate: 50, // 50% — large tax
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "Broke Character",
      countryId: "US",
      homeState: "US-CA",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 999_999_999, // stale mirror still very high
      currencyBalances: { campaign: 100, personal: { USD: 0 } }, // real balance below tax
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "US-CA", population: 100_000, gdp: 1_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000);

    const result = await processCaucusTax(true, 100);

    expect(result.membersTaxed).toBe(0);
    expect(result.totalTaxed).toBe(0);
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
  });

  // Regression test for #2816: the caucus treasury must be credited only by
  // debits that actually landed. A guarded $gte debit that no-ops (raced
  // balance drain between read and write) must NOT inflate the caucus.
  it("does not credit the caucus treasury when the guarded debit no-ops", async () => {
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "Test Caucus",
      countryId: "US",
      partyId: "1",
      disbandedAt: null,
      taxRate: 10,
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "Raced Character",
      countryId: "US",
      homeState: "US-CA",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 0,
      currencyBalances: { campaign: 50_000, personal: { USD: 0 } },
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "US-CA", population: 100_000, gdp: 1_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000);

    // The $gte-guarded debit fails to match (balance drained concurrently).
    db.collectionMocks["characters"]!.updateOne = vi
      .fn()
      .mockResolvedValue({ modifiedCount: 0, matchedCount: 0 });

    const result = await processCaucusTax(true, 100);

    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(1);
    expect(result.membersTaxed).toBe(0);
    expect(result.totalTaxed).toBe(0);
    // No treasury credit and no debit tx entry for the failed debit.
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
    expect(vi.mocked(emitTreasuryTransaction)).not.toHaveBeenCalled();
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
  });

  // Regression test for #2816 (field mismatch): with forex OFF the debit
  // targets `funds`, so the affordability pre-check must read `funds` too —
  // not a rich currencyBalances.campaign that the debit would never touch.
  it("pre-checks the debited field when forex is off (rich campaign mirror, broke funds)", async () => {
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "Test Caucus",
      countryId: "US",
      partyId: "1",
      disbandedAt: null,
      taxRate: 10,
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "Legacy Character",
      countryId: "US",
      homeState: "US-CA",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 100, // debited field — below the tax
      currencyBalances: { campaign: 50_000, personal: { USD: 0 } }, // NOT debited when forex off
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "US-CA", population: 100_000, gdp: 1_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000); // tax = 1_000 > funds

    const result = await processCaucusTax(false, 100);

    expect(result.membersTaxed).toBe(0);
    expect(result.totalTaxed).toBe(0);
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["caucuses"]!.updateOne).not.toHaveBeenCalled();
  });

  it("debits `funds` when forex is off and credits the caucus by the debited amount", async () => {
    const charId = new ObjectId();
    const caucusId = new ObjectId();
    const caucus = {
      _id: caucusId,
      name: "Test Caucus",
      countryId: "US",
      partyId: "1",
      disbandedAt: null,
      taxRate: 10,
      treasury: 0,
    };
    const membership = {
      _id: new ObjectId(),
      caucusId,
      memberType: "character",
      memberId: charId,
      status: "active",
    };
    const character = {
      _id: charId,
      name: "Legacy Character",
      countryId: "US",
      homeState: "US-CA",
      donorBaseLevel: 0,
      currentOffice: null,
      politicalInfluence: 0,
      funds: 5_000,
      currencyBalances: undefined,
    };

    setupCollection("caucuses", [caucus]);
    setupCollection("caucusMemberships", [membership]);
    setupCollection("characters", [character]);
    setupCollection("npps", []);
    setupCollection("states", [{ _id: "US-CA", population: 100_000, gdp: 1_000_000 }]);
    vi.mocked(projectCharacterGeneration).mockReturnValue(10_000); // tax = 1_000

    const result = await processCaucusTax(false, 100);

    expect(result.membersTaxed).toBe(1);
    expect(result.totalTaxed).toBe(1_000);

    const [filter, update] = db.collectionMocks["characters"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $inc: Record<string, number> },
    ];
    expect(filter).toMatchObject({ funds: { $gte: 1_000 } });
    expect(update.$inc).toEqual({ funds: -1_000 });

    const [caucusFilter, caucusUpdate] = db.collectionMocks["caucuses"]!.updateOne.mock
      .calls[0] as [Record<string, unknown>, { $inc: Record<string, number> }];
    expect(caucusFilter).toMatchObject({ _id: caucusId });
    expect(caucusUpdate.$inc).toEqual({ treasury: 1_000 });
  });
});
