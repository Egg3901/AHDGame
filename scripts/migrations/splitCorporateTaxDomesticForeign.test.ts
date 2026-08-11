/**
 * Unit tests for the domestic/foreign corp tax split migration. Uses MockDb to avoid
 * needing a live MongoDB — the connectDb/closeDb utilities are stubbed out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "../../src/lib/test-utils/mockDb";
import type { Db } from "mongodb";

// Stub the db utilities: connectDb returns our mock; closeDb is a noop.
vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

// Stub budget/revenue so the migration's recalculation step doesn't try to read
// collections that the mock hasn't been primed for — we just verify the migration
// invokes these helpers with the expected shape.
vi.mock("../../src/lib/budget/revenue", () => ({
  calculateFederalRevenue: vi.fn().mockResolvedValue({
    incomeTax: 0,
    domesticCorporateTax: 100,
    foreignCorporateTax: 25,
    payrollTax: 0,
    tariffs: 0,
    salesTax: 0,
    healthcareIncome: 0,
    other: 0,
    total: 125,
  }),
  calculateStateRevenue: vi.fn().mockResolvedValue({
    incomeTax: 0,
    salesTax: 0,
    domesticCorporateTax: 60,
    foreignCorporateTax: 20,
    propertyTax: 0,
    federalGrants: 100,
    other: 0,
    total: 180,
  }),
}));

import { migrate, rollback, LEGACY_TO_NEW_IDS } from "./splitCorporateTaxDomesticForeign";
import { connectDb } from "../utils/db";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("splitCorporateTaxDomesticForeign migration", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-create every collection the migration touches.
    for (const name of [
      "legislationTypes",
      "enactedLaws",
      "bills",
      "committeeAssignments",
      "statePolicyRecords",
      "federalBudget",
      "stateBudgets",
    ]) {
      db.collection(name);
    }
    vi.mocked(connectDb).mockResolvedValue(db as unknown as Db);
  });

  it("renames all 5 legacy legislation ids (US federal + state, UK, JP, DE)", async () => {
    const legacyIds = Object.keys(LEGACY_TO_NEW_IDS);
    // Return an existing doc for every legacy id.
    db.collectionMocks.legislationTypes.findOne = vi
      .fn()
      .mockImplementation(async (filter: { _id: string }) =>
        legacyIds.includes(filter._id)
          ? {
              _id: filter._id,
              name: "Corporate Tax Rate Act",
              description: "Sets corporate tax",
              taxRateChange: { scope: "federal", taxType: "corporateTax" },
            }
          : null
      );
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));

    await migrate();

    // One delete per legacy id.
    expect(db.collectionMocks.legislationTypes.deleteOne).toHaveBeenCalledTimes(legacyIds.length);
    for (const legacyId of legacyIds) {
      expect(db.collectionMocks.legislationTypes.deleteOne).toHaveBeenCalledWith({
        _id: legacyId,
      });
    }
    // One upsert per legacy id, with the new domestic id.
    for (const newId of Object.values(LEGACY_TO_NEW_IDS)) {
      expect(db.collectionMocks.legislationTypes.updateOne).toHaveBeenCalledWith(
        { _id: newId },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            _id: newId,
            subCategory: "Corporate taxation",
            taxRateChange: expect.objectContaining({ taxType: "domesticCorporateTax" }),
          }),
        }),
        { upsert: true }
      );
    }
  });

  it("remaps legislationTypeId across the 4 cross-collection references", async () => {
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue(null);
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));

    await migrate();

    // Each of the 4 collections gets updateMany called per legacy→new pair.
    const pairs = Object.entries(LEGACY_TO_NEW_IDS);
    for (const coll of [
      "enactedLaws",
      "bills",
      "committeeAssignments",
      "statePolicyRecords",
    ] as const) {
      for (const [legacyId, newId] of pairs) {
        expect(db.collectionMocks[coll].updateMany).toHaveBeenCalledWith(
          { legislationTypeId: legacyId },
          { $set: { legislationTypeId: newId } }
        );
      }
    }
  });

  it("splits federalBudget corporateTax rate into domestic + foreign (same value) and 75/25 base", async () => {
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue(null);
    // Legacy-shape budget doc.
    const legacyBudget = {
      _id: "federal",
      countryId: "US",
      taxRates: { corporateTax: 21 },
      taxBases: { corporateProfits: 2_000_000 },
      revenue: {},
      debt: { principal: 0, interestRate: 0 },
    };
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([legacyBudget]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));

    await migrate();

    // Verify the split was applied: find the updateOne call that targets the federal
    // budget doc (the $set/$unset shape, not the recalculation that follows).
    const updates = db.collectionMocks.federalBudget.updateOne.mock.calls;
    const splitUpdate = updates.find(
      (call: unknown[]) =>
        (call[1] as { $set?: Record<string, unknown> })?.$set?.["taxRates.domesticCorporateTax"] !==
        undefined
    );
    expect(splitUpdate).toBeDefined();
    const update = splitUpdate![1] as {
      $set: Record<string, number>;
      $unset: Record<string, string>;
    };
    expect(update.$set["taxRates.domesticCorporateTax"]).toBe(21);
    expect(update.$set["taxRates.foreignCorporateTax"]).toBe(21); // day-one parity
    expect(update.$set["taxBases.domesticCorporateProfits"]).toBe(1_500_000); // 75%
    expect(update.$set["taxBases.foreignCorporateProfits"]).toBe(500_000); // 25%
    expect(update.$unset["taxRates.corporateTax"]).toBe("");
    expect(update.$unset["taxBases.corporateProfits"]).toBe("");
    expect(update.$unset["revenue.corporateTax"]).toBe("");
  });

  it("splits stateBudgets identically to federalBudget", async () => {
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue(null);
    const legacyState = {
      _id: "US_CA",
      taxRates: { corporateTax: 6 },
      taxBases: { corporateProfits: 400_000 },
      revenue: { federalGrants: 100 },
    };
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([legacyState]));

    await migrate();

    const updates = db.collectionMocks.stateBudgets.updateOne.mock.calls;
    const splitUpdate = updates.find(
      (call: unknown[]) =>
        (call[1] as { $set?: Record<string, unknown> })?.$set?.["taxRates.domesticCorporateTax"] !==
        undefined
    );
    expect(splitUpdate).toBeDefined();
    const update = splitUpdate![1] as {
      $set: Record<string, number>;
      $unset: Record<string, string>;
    };
    expect(update.$set["taxRates.domesticCorporateTax"]).toBe(6);
    expect(update.$set["taxRates.foreignCorporateTax"]).toBe(6);
    expect(update.$set["taxBases.domesticCorporateProfits"]).toBe(300_000);
    expect(update.$set["taxBases.foreignCorporateProfits"]).toBe(100_000);
  });

  it("is idempotent — already-migrated docs are skipped", async () => {
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue(null);
    const alreadyMigrated = {
      _id: "federal",
      countryId: "US",
      taxRates: { domesticCorporateTax: 21, foreignCorporateTax: 21 },
      taxBases: { domesticCorporateProfits: 1_500_000, foreignCorporateProfits: 500_000 },
      revenue: {},
    };
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([alreadyMigrated]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));

    await migrate();

    // No split-update should have been issued for the already-migrated doc.
    const updates = db.collectionMocks.federalBudget.updateOne.mock.calls;
    const splitUpdates = updates.filter(
      (call: unknown[]) =>
        (call[1] as { $set?: Record<string, unknown> })?.$set?.["taxRates.domesticCorporateTax"] !==
        undefined
    );
    expect(splitUpdates.length).toBe(0);
  });

  it("rollback refuses when any foreign rate diverges from its domestic counterpart", async () => {
    const divergent = {
      _id: "federal",
      taxRates: { domesticCorporateTax: 21, foreignCorporateTax: 35 },
    };
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([divergent]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));

    await expect(rollback()).rejects.toThrow(/Refusing to rollback/);
  });

  it("rollback collapses split fields back into legacy corporateTax when rates match", async () => {
    const parity = {
      _id: "federal",
      taxRates: { domesticCorporateTax: 21, foreignCorporateTax: 21 },
      taxBases: { domesticCorporateProfits: 1_500_000, foreignCorporateProfits: 500_000 },
    };
    db.collectionMocks.federalBudget.find.mockReturnValue(makeCursor([parity]));
    db.collectionMocks.stateBudgets.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue(null);

    await rollback();

    const updates = db.collectionMocks.federalBudget.updateOne.mock.calls;
    const collapse = updates.find(
      (call: unknown[]) =>
        (call[1] as { $set?: Record<string, unknown> })?.$set?.["taxRates.corporateTax"] !==
        undefined
    );
    expect(collapse).toBeDefined();
    const u = collapse![1] as { $set: Record<string, number>; $unset: Record<string, string> };
    expect(u.$set["taxRates.corporateTax"]).toBe(21);
    expect(u.$set["taxBases.corporateProfits"]).toBe(2_000_000); // sum of both split fields
    expect(u.$unset["taxRates.domesticCorporateTax"]).toBe("");
    expect(u.$unset["taxRates.foreignCorporateTax"]).toBe("");
  });
});
