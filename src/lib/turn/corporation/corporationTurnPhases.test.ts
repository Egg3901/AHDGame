import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { GDP_DOMESTIC_CORPORATE_FACTOR, GDP_FOREIGN_CORPORATE_FACTOR } from "@/lib/budget/revenue";
import { updateCorporateTaxBases } from "./corporationTurnPhases";
import type { CorporationLookups } from "./types";

/**
 * Regression coverage for the fiscal-scale audit (2026-07-29): `updateCorporateTaxBases`
 * used to floor EVERY country's domestic/foreign corporate-profit tax base at the same
 * universal GDP_DOMESTIC_CORPORATE_FACTOR/GDP_FOREIGN_CORPORATE_FACTOR (6%/2% of GDP),
 * regardless of what that country's own seed authored. A command economy seeded at
 * ~13.5%/4.5% of GDP (the "Total Surplus Remittance" enterprise-profit mechanism -
 * see makeEasternBlocBudget1953 in seeds/reference/budgets.ts) got silently crashed down
 * to the generic 4.5%/1.5% floor within the first in-game year, erasing several points of
 * GDP in revenue with no player-visible cause and no policy change behind it. These tests
 * pin the fixed behavior: the floor now reads `taxBaseGdpShareBaseline` (seeded once, at
 * bootstrap, from the country's own authored taxBases - see buildNationalBudgetSeed) and
 * only falls back to the universal constants when no baseline is recorded.
 */
function buildLookups(
  federalBudgets: FederalBudget[],
  overrides: Partial<CorporationLookups> = {}
): CorporationLookups {
  return {
    federalBudgets,
    exchangeRatesByCurrency: new Map(),
    stateCountryMap: new Map(),
    ...overrides,
  } as unknown as CorporationLookups;
}

function makeBudget(overrides: Partial<FederalBudget> = {}): FederalBudget {
  return {
    _id: "BG",
    countryId: "BG",
    fiscalYear: 1953,
    gdp: 40_000_000_000,
    taxBases: {
      taxableIncome: 8_000_000_000,
      domesticCorporateProfits: 5_400_000_000,
      foreignCorporateProfits: 1_800_000_000,
      wagesAndSalaries: 14_000_000_000,
      importValue: 4_000_000_000,
      taxableSales: 24_000_000_000,
    },
    ...overrides,
  } as unknown as FederalBudget;
}

describe("updateCorporateTaxBases", () => {
  let db: MockDb;

  it("floors an authored high corporate-profit country at ITS OWN GDP share, not the universal constant", async () => {
    db = createMockDb();
    const budget = makeBudget({
      // Authored ~13.5%/4.5% of GDP (Eastern Bloc-style enterprise surplus base).
      taxBaseGdpShareBaseline: {
        domesticCorporateProfits: 0.135,
        foreignCorporateProfits: 0.045,
      },
    });

    await updateCorporateTaxBases({
      db: db as unknown as Db,
      lookups: buildLookups([budget]),
      // Near-zero actual corp income - matches a command economy's SOEs, which
      // is exactly the case that exposed the bug (the 25% "actual" term could
      // never rescue the base once the 75% floor used the wrong constant).
      domesticIncomeByCountry: new Map([["BG", 0]]),
      foreignIncomeByCountry: new Map([["BG", 0]]),
      domesticIncomeByOperatingState: new Map(),
      foreignIncomeByOperatingState: new Map(),
    });

    const ops = db.collectionMocks.federalBudget!.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;

    // Expected floor: gdp × authored share × 0.75 (25% actual term is 0 here).
    const expectedDomestic = 40_000_000_000 * 0.135 * 0.75;
    const expectedForeign = 40_000_000_000 * 0.045 * 0.75;
    expect(set["taxBases.domesticCorporateProfits"]).toBeCloseTo(expectedDomestic, 0);
    expect(set["taxBases.foreignCorporateProfits"]).toBeCloseTo(expectedForeign, 0);

    // The old universal-constant floor (6%/2% of GDP) must NOT be what's written -
    // this is the exact bug: it silently discarded ~9 points of GDP for a country
    // seeded well above the generic default.
    const oldBuggyDomestic = 40_000_000_000 * GDP_DOMESTIC_CORPORATE_FACTOR * 0.75;
    const oldBuggyForeign = 40_000_000_000 * GDP_FOREIGN_CORPORATE_FACTOR * 0.75;
    expect(set["taxBases.domesticCorporateProfits"]).not.toBeCloseTo(oldBuggyDomestic, 0);
    expect(set["taxBases.foreignCorporateProfits"]).not.toBeCloseTo(oldBuggyForeign, 0);
  });

  it("falls back to the universal GDP factor when no baseline is recorded (legacy budgets)", async () => {
    db = createMockDb();
    const budget = makeBudget({ taxBaseGdpShareBaseline: undefined });

    await updateCorporateTaxBases({
      db: db as unknown as Db,
      lookups: buildLookups([budget]),
      domesticIncomeByCountry: new Map([["BG", 0]]),
      foreignIncomeByCountry: new Map([["BG", 0]]),
      domesticIncomeByOperatingState: new Map(),
      foreignIncomeByOperatingState: new Map(),
    });

    const ops = db.collectionMocks.federalBudget!.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;

    const expectedDomestic = 40_000_000_000 * GDP_DOMESTIC_CORPORATE_FACTOR * 0.75;
    const expectedForeign = 40_000_000_000 * GDP_FOREIGN_CORPORATE_FACTOR * 0.75;
    expect(set["taxBases.domesticCorporateProfits"]).toBeCloseTo(expectedDomestic, 0);
    expect(set["taxBases.foreignCorporateProfits"]).toBeCloseTo(expectedForeign, 0);
  });

  it("does not erode an authored corporate-profit GDP share across repeated turns absent any policy change", async () => {
    // Regression for the observed defect: revenue silently decaying turn over
    // turn with no policy action behind it. Run the phase 3 times in a row
    // (simulating 3 turns) with a fixed baseline, fixed GDP, and zero real
    // corp income each time (as a command-economy SOE would present) and
    // confirm the resulting base's share of GDP stays pinned at the authored
    // 13.5%/4.5% instead of drifting toward the universal 4.5%/1.5% floor.
    const baseline = { domesticCorporateProfits: 0.135, foreignCorporateProfits: 0.045 };
    const gdp = 40_000_000_000;

    for (let turn = 0; turn < 3; turn++) {
      db = createMockDb();
      const budget = makeBudget({ gdp, taxBaseGdpShareBaseline: baseline });

      await updateCorporateTaxBases({
        db: db as unknown as Db,
        lookups: buildLookups([budget]),
        domesticIncomeByCountry: new Map([["BG", 0]]),
        foreignIncomeByCountry: new Map([["BG", 0]]),
        domesticIncomeByOperatingState: new Map(),
        foreignIncomeByOperatingState: new Map(),
      });

      const ops = db.collectionMocks.federalBudget!.bulkWrite.mock.calls[0][0];
      const set = ops[0].updateOne.update.$set;
      const domesticShare = set["taxBases.domesticCorporateProfits"] / gdp;
      const foreignShare = set["taxBases.foreignCorporateProfits"] / gdp;

      // 0.75x the authored share (25% weight is zero actual income), every turn -
      // no drift toward the generic 4.5%/1.5% floor across repeated calls.
      expect(domesticShare).toBeCloseTo(0.135 * 0.75, 4);
      expect(foreignShare).toBeCloseTo(0.045 * 0.75, 4);
    }
  });

  it("still applies the real 25% actual-income weight on top of the country's own floor", async () => {
    db = createMockDb();
    const budget = makeBudget({
      taxBaseGdpShareBaseline: {
        domesticCorporateProfits: 0.135,
        foreignCorporateProfits: 0.045,
      },
    });

    await updateCorporateTaxBases({
      db: db as unknown as Db,
      lookups: buildLookups([budget]),
      domesticIncomeByCountry: new Map([["BG", 1_000_000_000]]),
      foreignIncomeByCountry: new Map([["BG", 200_000_000]]),
      domesticIncomeByOperatingState: new Map(),
      foreignIncomeByOperatingState: new Map(),
    });

    const ops = db.collectionMocks.federalBudget!.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;

    const expectedDomestic = 40_000_000_000 * 0.135 * 0.75 + 1_000_000_000 * 0.25;
    const expectedForeign = 40_000_000_000 * 0.045 * 0.75 + 200_000_000 * 0.25;
    expect(set["taxBases.domesticCorporateProfits"]).toBeCloseTo(expectedDomestic, 0);
    expect(set["taxBases.foreignCorporateProfits"]).toBeCloseTo(expectedForeign, 0);
  });
});
