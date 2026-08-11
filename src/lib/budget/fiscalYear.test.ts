/**
 * Tests for fiscalYear.ts — covers the two pure timing functions and the
 * processFiscalYear orchestrator. The orchestrator is tested via heavy mocking
 * because it coordinates six other modules and multiple DB collections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isFiscalYearEnd, calculateFiscalYear, processFiscalYear } from "./fiscalYear";
import type { Db } from "mongodb";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("./revenue", () => ({
  calculateFederalRevenue: vi.fn(),
  calculateStateRevenue: vi.fn(),
  applyGrowthToFederalBases: vi.fn((bases) => bases),
  applyGrowthToStateBases: vi.fn((bases) => bases),
  normalizeFederalTaxRates: vi.fn((taxRates) => taxRates ?? null),
  normalizeStateTaxRates: vi.fn((taxRates) => taxRates ?? null),
}));

vi.mock("./spending", () => ({
  calculateFederalSpending: vi.fn(),
  calculateStateSpending: vi.fn(),
}));

vi.mock("./debt", () => ({
  processAnnualDebt: vi.fn(),
  triggerDebtCeilingCrisis: vi.fn(),
  getDebtThreshold: vi.fn(),
}));

vi.mock("./grants", () => ({
  processFormulaGrants: vi.fn(),
  updateStateGrantRevenue: vi.fn(),
}));

vi.mock("./inflation", () => ({
  calculateCountryInflation: vi.fn(),
}));

vi.mock("@/lib/sovereignDefault/crisisDetection", () => ({
  evaluateSovereignAuctionForCountry: vi.fn().mockResolvedValue(null),
}));

import {
  calculateFederalRevenue,
  calculateStateRevenue,
  applyGrowthToFederalBases,
} from "./revenue";
import { calculateFederalSpending, calculateStateSpending } from "./spending";
import { processAnnualDebt, triggerDebtCeilingCrisis, getDebtThreshold } from "./debt";
import { processFormulaGrants, updateStateGrantRevenue } from "./grants";
import { calculateCountryInflation } from "./inflation";

// ── isFiscalYearEnd ───────────────────────────────────────────────────────────

describe("isFiscalYearEnd", () => {
  // TURNS_PER_YEAR = 48; FISCAL_YEAR_START_TURN_IN_YEAR = 40.
  // Turn 40 of year 1 is absolute turn 40.
  // Turn 40 of year 2 is absolute turn 88 (48 + 40).

  it("returns true on turn 40 (first October of the game)", () => {
    expect(isFiscalYearEnd(40)).toBe(true);
  });

  it("returns false on turn 39 (last turn before fiscal year boundary)", () => {
    expect(isFiscalYearEnd(39)).toBe(false);
  });

  it("returns false on turn 41 (one turn past fiscal year boundary)", () => {
    expect(isFiscalYearEnd(41)).toBe(false);
  });

  it("returns false on turn 1 (start of game)", () => {
    expect(isFiscalYearEnd(1)).toBe(false);
  });

  it("returns false on turn 48 (end of year — December, not October)", () => {
    expect(isFiscalYearEnd(48)).toBe(false);
  });

  it("returns true on turn 88 (turn 40 of year 2 — 48 + 40)", () => {
    // (88 - 1) % 48 + 1 = 87 % 48 + 1 = 39 + 1 = 40 ✓
    expect(isFiscalYearEnd(88)).toBe(true);
  });

  it("returns true on turn 136 (turn 40 of year 3 — 96 + 40)", () => {
    // (136 - 1) % 48 + 1 = 135 % 48 + 1 = 39 + 1 = 40 ✓
    expect(isFiscalYearEnd(136)).toBe(true);
  });

  it("returns false on turn 87 (turn 39 of year 2 — just before boundary)", () => {
    // (87 - 1) % 48 + 1 = 86 % 48 + 1 = 38 + 1 = 39 ✓
    expect(isFiscalYearEnd(87)).toBe(false);
  });

  it("returns false on turn 89 (turn 41 of year 2 — just after boundary)", () => {
    expect(isFiscalYearEnd(89)).toBe(false);
  });

  it("returns false on turn 49 (turn 1 of year 2)", () => {
    expect(isFiscalYearEnd(49)).toBe(false);
  });
});

// ── calculateFiscalYear ───────────────────────────────────────────────────────

describe("calculateFiscalYear", () => {
  // Federal fiscal year works like US government: FY2021 runs Oct 2020–Sep 2021.
  // At turn 40 of calendar year 2020, the fiscal year flips to 2021.

  it("returns current year + 1 when turn is at the fiscal boundary (turn 40)", () => {
    // Turn 40 in year 2020 → FY2021
    expect(calculateFiscalYear(2020, 40)).toBe(2021);
  });

  it("returns current year + 1 when turn is past the fiscal boundary (turn 45)", () => {
    // Turn 45 in year 2020 → still FY2021 (within the Oct–Dec window)
    expect(calculateFiscalYear(2020, 45)).toBe(2021);
  });

  it("returns current year + 1 at turn 48 (end of year, still FY2021)", () => {
    expect(calculateFiscalYear(2020, 48)).toBe(2021);
  });

  it("returns current year when turn is before the fiscal boundary (turn 39)", () => {
    // Turn 39 in year 2020 → still FY2020 (Jan–Sep)
    expect(calculateFiscalYear(2020, 39)).toBe(2020);
  });

  it("returns current year when turn is in January (turn 1)", () => {
    expect(calculateFiscalYear(2021, 49)).toBe(2021); // turn 49 = turn 1 of year 2
  });

  it("handles multi-year absolute turns correctly — turn 88 is year 2 turn 40", () => {
    // Turn 88 = turn 40 of year 2 (2021) → FY2022
    // (88 - 1) % 48 + 1 = 40
    expect(calculateFiscalYear(2021, 88)).toBe(2022);
  });

  it("handles multi-year absolute turns correctly — turn 87 is year 2 turn 39", () => {
    // Turn 87 = turn 39 of year 2 (2021) → FY2021 still
    expect(calculateFiscalYear(2021, 87)).toBe(2021);
  });

  it("wraps correctly into year 3 — turn 136 is turn 40 of year 3", () => {
    // Turn 136 = turn 40 of year 3 (2022) → FY2023
    expect(calculateFiscalYear(2022, 136)).toBe(2023);
  });

  it("correctly computes turn-in-year for absolute turn 97 (turn 1 of year 3)", () => {
    // (97 - 1) % 48 + 1 = 96 % 48 + 1 = 0 + 1 = 1 → before boundary → return currentYear
    expect(calculateFiscalYear(2022, 97)).toBe(2022);
  });
});

// ── processFiscalYear helpers ─────────────────────────────────────────────────

/**
 * Build a minimal but realistic FederalBudget fixture.
 * Avoids coupling to every field — just enough for the function under test.
 */
function makeFederalBudget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "federal",
    countryId: "US",
    fiscalYear: 2025,
    gdp: 27_000_000_000_000,
    taxRates: {
      incomeTax: 22,
      domesticCorporateTax: 21,
      foreignCorporateTax: 21,
      payrollTax: 7.65,
      tariffs: 3.0,
      salesTax: 0.0,
    },
    taxBases: {
      taxableIncome: 9_450_000_000_000,
      domesticCorporateProfits: 1_620_000_000_000,
      foreignCorporateProfits: 540_000_000_000,
      wagesAndSalaries: 8_370_000_000_000,
      importValue: 810_000_000_000,
      taxableSales: 0,
    },
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 3.0,
      inflationRate: 2.5,
      tradeGrowth: 2.0,
      lastUpdated: new Date(),
    },
    revenue: { total: 4_400_000_000_000, byCategory: {} },
    spending: { total: 6_000_000_000_000, byCategory: {}, stateGrants: 0 },
    debt: {
      principal: 22_000_000_000_000,
      interestRate: 0.04,
      ceiling: 31_400_000_000_000,
    },
    surplus: -1_600_000_000_000,
    balance: 0,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStateBudget(stateId: string): Record<string, unknown> {
  // Tests use compound stateIds like "US-TX" / "US-CA"; extract country prefix
  // so the fixture's countryId matches what processFiscalYear filters by.
  const inferredCountry = stateId.includes("-") ? stateId.split("-")[0] : "US";
  return {
    _id: stateId,
    stateId,
    countryId: inferredCountry,
    fiscalYear: 2025,
    stateGdp: 500_000_000_000,
    taxBases: {
      taxableIncome: 175_000_000_000,
      taxableSales: 275_000_000_000,
      domesticCorporateProfits: 60_000_000_000,
      foreignCorporateProfits: 15_000_000_000,
      propertyValue: 1_500_000_000_000,
    },
    taxRates: {
      incomeTax: 5,
      salesTax: 6,
      domesticCorporateTax: 8,
      foreignCorporateTax: 12,
      propertyTax: 1,
    },
    revenue: {
      incomeTax: 0,
      salesTax: 0,
      domesticCorporateTax: 0,
      foreignCorporateTax: 0,
      propertyTax: 0,
      federalGrants: 0,
      other: 0,
      total: 100_000_000_000,
    },
    spending: { total: 95_000_000_000, byCategory: {} },
    surplus: 5_000_000_000,
    balance: 50_000_000_000,
    updatedAt: new Date(),
  };
}

/**
 * Create a minimal mock Db that handles the collection access patterns
 * used by processFiscalYear — without depending on MockDb's fluent cursor.
 */
function makeDb(options: {
  federalBudget?: Record<string, unknown> | null;
  federalBudgets?: Record<string, unknown>[];
  states?: Record<string, unknown>[];
  stateMetrics?: Record<string, unknown>[];
  stateBudgets?: Record<string, unknown>[];
}) {
  const {
    federalBudget = makeFederalBudget(),
    federalBudgets,
    states = [],
    stateMetrics = [],
    stateBudgets = [],
  } = options;
  const resolvedFederalBudgets = federalBudgets ?? (federalBudget === null ? [] : [federalBudget]);

  const federalBudgetUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const stateBudgetUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const federalBudgetSnapshotReplaceOne = vi.fn().mockResolvedValue({
    modifiedCount: 1,
    matchedCount: 1,
    upsertedCount: 0,
  });

  const db = {
    collection: vi.fn((name: string) => {
      switch (name) {
        case "federalBudget":
          return {
            find: vi
              .fn()
              .mockReturnValue({ toArray: vi.fn().mockResolvedValue(resolvedFederalBudgets) }),
            findOne: vi.fn().mockImplementation((query: { _id?: string }) => {
              if (!query?._id) return Promise.resolve(resolvedFederalBudgets[0] ?? null);
              const found = resolvedFederalBudgets.find((b) => b._id === query._id);
              return Promise.resolve(found ?? null);
            }),
            updateOne: federalBudgetUpdateOne,
          };
        case "states":
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
          };
        case "macroMetrics":
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(stateMetrics) }),
            findOne: vi.fn().mockImplementation((query: { _id: string }) => {
              const found = stateMetrics.find((m) => m._id === query._id);
              return Promise.resolve(found ?? null);
            }),
          };
        case "stateBudgets":
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(stateBudgets) }),
            findOne: vi
              .fn()
              .mockImplementation(
                (query: { _id?: string; stateId?: string; countryId?: string }) => {
                  const found = stateBudgets.find((b) => {
                    if (query._id && b._id !== query._id) return false;
                    if (query.stateId && b.stateId !== query.stateId) return false;
                    if (query.countryId && b.countryId !== query.countryId) return false;
                    return true;
                  });
                  return Promise.resolve(found ?? null);
                }
              ),
            updateOne: stateBudgetUpdateOne,
          };
        case "federalBudgetSnapshots":
          return {
            replaceOne: federalBudgetSnapshotReplaceOne,
          };
        default:
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({}),
            replaceOne: vi.fn().mockResolvedValue({}),
          };
      }
    }),
    _federalBudgetUpdateOne: federalBudgetUpdateOne,
    _stateBudgetUpdateOne: stateBudgetUpdateOne,
    _federalBudgetSnapshotReplaceOne: federalBudgetSnapshotReplaceOne,
  };

  return db;
}

// ── processFiscalYear ─────────────────────────────────────────────────────────

describe("processFiscalYear", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns for all modules
    vi.mocked(calculateFederalRevenue).mockResolvedValue({
      total: 4_500_000_000_000,
      byCategory: {},
    } as never);
    vi.mocked(calculateFederalSpending).mockResolvedValue({
      total: 6_200_000_000_000,
      byCategory: {},
      stateGrants: 0,
    } as never);
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 23_700_000_000_000,
      interestRate: 0.04,
      debtToGdpRatio: 0.87,
      creditRating: "AA",
      ceilingExceeded: false,
    } as never);
    vi.mocked(getDebtThreshold).mockReturnValue({
      maxRatio: 0.8,
      rating: "AA",
      interestRate: 0.025,
      gdpPenalty: 0,
      trustPenalty: 0,
    } as never);
    vi.mocked(processFormulaGrants).mockResolvedValue({} as never);
    vi.mocked(updateStateGrantRevenue).mockResolvedValue(undefined as never);
    vi.mocked(calculateCountryInflation).mockResolvedValue(2.8 as never);
    vi.mocked(calculateStateRevenue).mockResolvedValue({
      total: 110_000_000_000,
      byCategory: {},
    } as never);
    vi.mocked(calculateStateSpending).mockResolvedValue({
      total: 100_000_000_000,
      byCategory: {},
    } as never);
    vi.mocked(applyGrowthToFederalBases).mockImplementation((bases) => bases as never);
  });

  it("returns early when no federal budget exists", async () => {
    const db = makeDb({ federalBudget: null });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // No revenue/spending/debt calls should be made
    expect(calculateFederalRevenue).not.toHaveBeenCalled();
    expect(processAnnualDebt).not.toHaveBeenCalled();
  });

  it("updates federal budget with new fiscal year data", async () => {
    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(db._federalBudgetUpdateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({
        $set: expect.objectContaining({
          fiscalYear: 2026,
        }),
      })
    );
  });

  it("computes surplus from revenue minus spending and writes it", async () => {
    // Revenue: 4.5T, Spending: 6.2T + grants 0 = 6.2T → surplus = -1.7T
    vi.mocked(processFormulaGrants).mockResolvedValue({} as never); // no grants

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const call = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "surplus" in ((c[1] as { $set: object }).$set as object)
    );
    expect(call).toBeDefined();
    const surplus = (call![1] as { $set: { surplus: number } }).$set.surplus;
    // 4.5T - 6.2T = -1.7T
    expect(surplus).toBeCloseTo(-1_700_000_000_000, -6);
  });

  it("adds state grant total to federal spending before computing surplus", async () => {
    // Grants distributed: TX gets 50B, CA gets 100B → total 150B added to spending
    vi.mocked(processFormulaGrants).mockResolvedValue({
      "US-TX": 50_000_000_000,
      "US-CA": 100_000_000_000,
    } as never);
    // spending mock returns 6.2T (no stateGrants included yet)
    vi.mocked(calculateFederalSpending).mockResolvedValue({
      total: 6_200_000_000_000,
      byCategory: {},
      stateGrants: 0,
    } as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const call = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "surplus" in ((c[1] as { $set: object }).$set as object)
    );
    const surplus = (call![1] as { $set: { surplus: number } }).$set.surplus;
    // revenue 4.5T - (spending 6.2T + grants 150B) = -1.85T
    expect(surplus).toBeCloseTo(-1_850_000_000_000, -6);
  });

  it("triggers debt ceiling crisis when ceiling is exceeded", async () => {
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 32_000_000_000_000, // exceeds $31.4T ceiling
      interestRate: 0.04,
      debtToGdpRatio: 1.18,
      creditRating: "BBB",
      ceilingExceeded: true,
    } as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(triggerDebtCeilingCrisis).toHaveBeenCalledWith(db, 2026);
  });

  it("does not trigger debt ceiling crisis when ceiling is not exceeded", async () => {
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 23_000_000_000_000,
      interestRate: 0.04,
      debtToGdpRatio: 0.85,
      creditRating: "AA",
      ceilingExceeded: false,
    } as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(triggerDebtCeilingCrisis).not.toHaveBeenCalled();
  });

  it("uses dynamic inflation from calculateCountryInflation", async () => {
    vi.mocked(calculateCountryInflation).mockResolvedValue(4.2 as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // Inflation update should be applied to economicFactors in the first updateOne
    const taxBaseUpdateCall = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "economicFactors.inflationRate" in ((c[1] as { $set: object }).$set as object)
    );
    expect(taxBaseUpdateCall).toBeDefined();
    const inflationRate = (
      taxBaseUpdateCall![1] as { $set: { "economicFactors.inflationRate": number } }
    ).$set["economicFactors.inflationRate"];
    expect(inflationRate).toBe(4.2);
  });

  it("uses pipeline GDP growth from stateMetrics national doc", async () => {
    const db = makeDb({
      stateMetrics: [
        {
          _id: "federal",
          economic: { gdpGrowth: { value: 3.8 } },
        },
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    // GDP growth from pipeline should be written to economicFactors
    const taxBaseUpdateCall = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "economicFactors.gdpGrowth" in ((c[1] as { $set: object }).$set as object)
    );
    expect(taxBaseUpdateCall).toBeDefined();
    const gdpGrowth = (taxBaseUpdateCall![1] as { $set: { "economicFactors.gdpGrowth": number } })
      .$set["economicFactors.gdpGrowth"];
    expect(gdpGrowth).toBe(3.8);
  });

  it("falls back to 2.5% GDP growth when national stateMetrics doc is missing", async () => {
    const db = makeDb({ stateMetrics: [] });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const taxBaseUpdateCall = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "economicFactors.gdpGrowth" in ((c[1] as { $set: object }).$set as object)
    );
    expect(taxBaseUpdateCall).toBeDefined();
    const gdpGrowth = (taxBaseUpdateCall![1] as { $set: { "economicFactors.gdpGrowth": number } })
      .$set["economicFactors.gdpGrowth"];
    expect(gdpGrowth).toBe(2.5);
  });

  it("grows GDP by gdpGrowth% when taxBases exist", async () => {
    const budget = makeFederalBudget({
      gdp: 27_000_000_000_000,
      economicFactors: {
        gdpGrowth: 2.5,
        wageGrowth: 3.0,
        inflationRate: 2.5,
        tradeGrowth: 2.0,
        lastUpdated: new Date(),
      },
      taxBases: {
        incomeTaxBase: 9_000_000_000_000,
        corporateTaxBase: 2_000_000_000_000,
        payrollTaxBase: 8_000_000_000_000,
        salesTaxBase: 0,
        propertyTaxBase: 0,
      },
    });

    const db = makeDb({ federalBudget: budget });

    // No pipeline override, so fallback 2.5% is used
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const taxBaseUpdateCall = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "gdp" in ((c[1] as { $set: object }).$set as object)
    );
    expect(taxBaseUpdateCall).toBeDefined();
    const newGdp = (taxBaseUpdateCall![1] as { $set: { gdp: number } }).$set.gdp;
    // No SSOT state.gdp present → fallback: 27T * (1 + 2.5/100) = 27.675T
    expect(newGdp).toBeCloseTo(27_675_000_000_000, -6);
  });

  it("derives federalBudget.gdp from Σ state.gdp × 1M when states carry SSOT gdp (A1)", async () => {
    const budget = makeFederalBudget({
      gdp: 27_000_000_000_000, // stale — must be ignored once states carry gdp
      economicFactors: {
        gdpGrowth: 2.5,
        wageGrowth: 3.0,
        inflationRate: 2.5,
        tradeGrowth: 2.0,
        lastUpdated: new Date(),
      },
      taxBases: {
        incomeTaxBase: 9_000_000_000_000,
        corporateTaxBase: 2_000_000_000_000,
        payrollTaxBase: 8_000_000_000_000,
        salesTaxBase: 0,
        propertyTaxBase: 0,
      },
    });
    const states = [
      { _id: "US-TX", countryId: "US", gdp: 500_000 }, // 500k million
      { _id: "US-CA", countryId: "US", gdp: 300_000 },
      { _id: "federal", countryId: "US", gdp: 9_999_999 }, // national-scope → excluded
      { _id: "UK-LON", countryId: "UK", gdp: 700_000 }, // foreign → excluded
    ];
    const db = makeDb({ federalBudget: budget, states });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const call = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "gdp" in ((c[1] as { $set: object }).$set as object)
    );
    const newGdp = (call![1] as { $set: { gdp: number } }).$set.gdp;
    // (500k + 300k) million × 1M = 800,000,000,000 (TX+CA only)
    expect(newGdp).toBeCloseTo(800_000_000_000, -6);
  });

  it("processes state budgets for each state", async () => {
    const states = [
      { _id: "US-TX", countryId: "US" },
      { _id: "US-CA", countryId: "US" },
    ];
    const stateBudgets = [makeStateBudget("US-TX"), makeStateBudget("US-CA")];

    const db = makeDb({ states, stateBudgets });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // Each state's budget should be updated (2 updateOne calls per state: tax bases + final)
    expect(db._stateBudgetUpdateOne).toHaveBeenCalledTimes(4);
  });

  it("derives stateGdp = state.gdp × 1M when the region carries SSOT gdp (A1)", async () => {
    const states = [{ _id: "US-TX", countryId: "US", gdp: 600_000 }]; // 600k million
    const stateBudgets = [makeStateBudget("US-TX")]; // stateGdp 500B (ignored once SSOT present)
    const db = makeDb({ states, stateBudgets });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const call = db._stateBudgetUpdateOne.mock.calls[0];
    const newStateGdp = (call[1] as { $set: { stateGdp: number } }).$set.stateGdp;
    // 600k million × 1M = 600,000,000,000 (snapshot of the SSOT, not compounded)
    expect(newStateGdp).toBeCloseTo(600_000_000_000, -6);
  });

  it("uses per-state GDP growth from stateMetrics rather than national average", async () => {
    // TX has stateMetrics showing 5.2% GDP growth. The state budget stateGdp should
    // grow by 5.2%, not by the national pipeline rate. We verify via the DB write.
    const states = [{ _id: "US-TX", countryId: "US" }];
    const stateBudgets = [makeStateBudget("US-TX")]; // stateGdp: 500B
    const stateMetrics = [{ _id: "US-TX", economic: { gdpGrowth: { value: 5.2 } } }];

    const db = makeDb({ states, stateBudgets, stateMetrics });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // Per-state GDP growth (5.2%) should produce: 500B * (1 + 5.2/100) = 526B
    const call = db._stateBudgetUpdateOne.mock.calls[0];
    const newStateGdp = (call[1] as { $set: { stateGdp: number } }).$set.stateGdp;
    expect(newStateGdp).toBeCloseTo(526_000_000_000, -6);
  });

  it("falls back to national GDP growth for states with no stateMetrics entry", async () => {
    const states = [{ _id: "US-WY", countryId: "US" }]; // no stateMetrics entry
    const stateBudgets = [makeStateBudget("US-WY")];
    // Pipeline national doc has 3.0% GDP growth
    const stateMetrics = [{ _id: "federal", economic: { gdpGrowth: { value: 3.0 } } }];

    const db = makeDb({ states, stateBudgets, stateMetrics });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const call = db._stateBudgetUpdateOne.mock.calls[0];
    const newStateGdp = (call[1] as { $set: { stateGdp: number } }).$set.stateGdp;
    // 500B * (1 + 3.0/100) = 515B
    expect(newStateGdp).toBeCloseTo(515_000_000_000, -6);
  });

  it("skips state fiscal processing when no state budget exists", async () => {
    const states = [{ _id: "US-DC", countryId: "US" }]; // has state entry
    const stateBudgets: Record<string, unknown>[] = []; // but no budget doc

    const db = makeDb({ states, stateBudgets });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // No state budget updateOne should be called for states without budgets
    expect(db._stateBudgetUpdateOne).not.toHaveBeenCalled();
  });

  it("distributes formula grants to states and calls updateStateGrantRevenue", async () => {
    vi.mocked(processFormulaGrants).mockResolvedValue({
      "US-TX": 80_000_000_000,
      "US-CA": 120_000_000_000,
    } as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(updateStateGrantRevenue).toHaveBeenCalledWith(db, "US-TX", "US", 80_000_000_000);
    expect(updateStateGrantRevenue).toHaveBeenCalledWith(db, "US-CA", "US", 120_000_000_000);
  });

  it("writes debt results to federal budget (principal, interestRate, debtToGdpRatio, creditRating)", async () => {
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 23_700_000_000_000,
      interestRate: 0.04,
      debtToGdpRatio: 0.87,
      creditRating: "AA",
      ceilingExceeded: false,
    } as never);

    const db = makeDb({});
    await processFiscalYear(db as unknown as Db, 2026, 600);

    const finalUpdateCall = db._federalBudgetUpdateOne.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        "$set" in (c[1] as object) &&
        "creditRating" in ((c[1] as { $set: object }).$set as object)
    );
    expect(finalUpdateCall).toBeDefined();
    const setOps = (finalUpdateCall![1] as { $set: Record<string, unknown> }).$set;
    expect(setOps["debt.principal"]).toBe(23_700_000_000_000);
    expect(setOps["debt.interestRate"]).toBe(0.04);
    expect(setOps.debtToGdpRatio).toBe(0.87);
    expect(setOps.creditRating).toBe("AA");
  });

  it("applies trust penalties when debt threshold has trustPenalty > 0", async () => {
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 40_000_000_000_000,
      interestRate: 0.1,
      debtToGdpRatio: 1.6,
      creditRating: "B",
      ceilingExceeded: false,
    } as never);
    vi.mocked(getDebtThreshold).mockReturnValue({
      maxRatio: Infinity,
      rating: "B",
      interestRate: 0.1,
      gdpPenalty: 0.5,
      trustPenalty: 10,
    } as never);

    // Trust penalties call updateMany on stateMetrics — need to expose it
    const updateMany = vi.fn().mockResolvedValue({});
    const db = makeDb({});
    // Save the raw mock function before spying to avoid infinite recursion
    const rawCollection = db.collection.getMockImplementation()!;
    vi.spyOn(db, "collection").mockImplementation((name: string) => {
      if (name === "macroMetrics") {
        const col = rawCollection(name);
        return { ...col, updateMany };
      }
      return rawCollection(name);
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    // SP4: the US is a playable-pipeline country — governance.publicTrust is
    // retired, so the legacy debt→trust `$inc` writes nowhere. The channel is
    // not lost: it now moves `governance.integrity` on the political board via
    // applyLegacyTrustDelta, which is asserted in the sovereign-default trust
    // tests. This case pins only that the LEGACY collection stays untouched.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not apply trust penalties when trustPenalty is 0", async () => {
    vi.mocked(getDebtThreshold).mockReturnValue({
      maxRatio: 0.8,
      rating: "AA",
      interestRate: 0.025,
      gdpPenalty: 0,
      trustPenalty: 0,
    } as never);

    const updateMany = vi.fn().mockResolvedValue({});
    const db = makeDb({});
    const rawCollection = db.collection.getMockImplementation()!;
    vi.spyOn(db, "collection").mockImplementation((name: string) => {
      if (name === "macroMetrics") {
        const col = rawCollection(name);
        return { ...col, updateMany };
      }
      return rawCollection(name);
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("accumulates surplus into state balance correctly", async () => {
    const stateBudget = makeStateBudget("US-CA");
    // existing balance: 50B, revenue: 110B, spending: 100B → new surplus: 10B
    // new balance: 50B + 10B = 60B
    vi.mocked(calculateStateRevenue).mockResolvedValue({
      total: 110_000_000_000,
      byCategory: {},
    } as never);
    vi.mocked(calculateStateSpending).mockResolvedValue({
      total: 100_000_000_000,
      byCategory: {},
    } as never);

    const db = makeDb({
      states: [{ _id: "US-CA", countryId: "US" }],
      stateBudgets: [stateBudget],
    });
    await processFiscalYear(db as unknown as Db, 2026, 600);

    // calls[0] is the tax base update, calls[1] is the final budget update with surplus/balance
    const call = db._stateBudgetUpdateOne.mock.calls[1];
    const setOps = (call[1] as { $set: Record<string, unknown> }).$set;
    expect(setOps.surplus).toBe(10_000_000_000);
    expect(setOps.balance).toBe(60_000_000_000); // 50B + 10B
  });

  it("processes non-US federal budgets with country-scoped helpers", async () => {
    const db = makeDb({
      federalBudgets: [
        makeFederalBudget(),
        makeFederalBudget({ _id: "JP", countryId: "JP", fiscalYear: 2020 }),
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(db._federalBudgetUpdateOne).toHaveBeenCalledWith(
      { _id: "JP" },
      expect.objectContaining({
        $set: expect.objectContaining({
          fiscalYear: 2026,
        }),
      })
    );
    expect(calculateCountryInflation).toHaveBeenCalledWith(db, "JP", expect.anything());
    // processFormulaGrants is US-only — non-US countries route central-to-regional
    // grants through their own enacted legislation (uk_local_government_funding,
    // jp_local_allocation_tax) marked isGrant=true, picked up by calculateFederalSpending.
    expect(processFormulaGrants).toHaveBeenCalledWith(db, expect.any(Number), "US");
    expect(processFormulaGrants).not.toHaveBeenCalledWith(db, expect.any(Number), "JP");
  });

  it("keeps debt ceiling crisis US-only while processing non-US budgets", async () => {
    vi.mocked(processAnnualDebt).mockResolvedValue({
      interestPayment: 880_000_000_000,
      newPrincipal: 40_000_000_000_000,
      interestRate: 0.04,
      debtToGdpRatio: 1.18,
      creditRating: "BBB",
      ceilingExceeded: true,
    } as never);

    const db = makeDb({
      federalBudgets: [makeFederalBudget({ _id: "JP", countryId: "JP", fiscalYear: 2020 })],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(triggerDebtCeilingCrisis).not.toHaveBeenCalled();
  });

  it("writes snapshots only for budgets that actually processed", async () => {
    const db = makeDb({
      federalBudgets: [
        makeFederalBudget(),
        makeFederalBudget({ _id: "JP", countryId: "JP", taxRates: undefined }),
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(db._federalBudgetSnapshotReplaceOne).toHaveBeenCalledTimes(1);
    expect(db._federalBudgetSnapshotReplaceOne.mock.calls[0][0]).toEqual({ _id: "US:FY2026" });
  });

  it("skips incomplete federal budgets that are missing taxRates", async () => {
    const db = makeDb({
      federalBudgets: [
        makeFederalBudget(),
        makeFederalBudget({ _id: "JP", countryId: "JP", taxRates: undefined }),
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(calculateFederalRevenue).toHaveBeenCalledTimes(1);
    expect(db._federalBudgetUpdateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({
        $set: expect.objectContaining({
          fiscalYear: 2026,
        }),
      })
    );
    expect(db._federalBudgetUpdateOne).not.toHaveBeenCalledWith({ _id: "JP" }, expect.anything());
  });

  it("skips state budgets that are missing taxRates without aborting other states", async () => {
    const db = makeDb({
      states: [
        { _id: "US-TX", countryId: "US" },
        { _id: "US-CA", countryId: "US" },
      ],
      stateBudgets: [
        makeStateBudget("US-TX"),
        { ...makeStateBudget("US-CA"), taxRates: undefined },
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(calculateStateRevenue).toHaveBeenCalledTimes(1);
    expect(db._stateBudgetUpdateOne).toHaveBeenCalledTimes(2);
    expect(db._stateBudgetUpdateOne).toHaveBeenNthCalledWith(
      1,
      { _id: "US-TX", countryId: "US" },
      expect.anything()
    );
    expect(db._stateBudgetUpdateOne).toHaveBeenNthCalledWith(
      2,
      { _id: "US-TX", countryId: "US" },
      expect.anything()
    );
  });

  describe("austerity cap when sovereign bailout active", () => {
    it("scales spending categories proportionally when imfSovereignBailoutActive and revenue < spending", async () => {
      const db = makeDb({
        federalBudget: makeFederalBudget({
          _id: "federal",
          countryId: "US",
          imfSovereignBailoutActive: true,
        }),
      });
      await processFiscalYear(db as unknown as Db, 2026, 600);

      const setCalls = db._federalBudgetUpdateOne.mock.calls;
      const finalSet = setCalls.find((c) => {
        const $set = (c[1] as { $set?: Record<string, unknown> }).$set;
        return $set && "spending" in $set;
      });
      expect(finalSet).toBeDefined();
      const $set = finalSet![1].$set as {
        spending: { total: number };
        surplus: number;
      };
      // Revenue mock = 4.5T, spending mock = 6.2T → cap to revenue
      expect($set.spending.total).toBeLessThanOrEqual(4_500_000_000_000);
      expect($set.surplus).toBeGreaterThanOrEqual(-1);
    });

    it("does not modify spending when imfSovereignBailoutActive is false", async () => {
      const db = makeDb({
        federalBudget: makeFederalBudget({
          _id: "federal",
          countryId: "US",
          imfSovereignBailoutActive: false,
        }),
      });
      await processFiscalYear(db as unknown as Db, 2026, 600);

      const setCalls = db._federalBudgetUpdateOne.mock.calls;
      const finalSet = setCalls.find((c) => {
        const $set = (c[1] as { $set?: Record<string, unknown> }).$set;
        return $set && "spending" in $set;
      });
      const $set = finalSet![1].$set as { spending: { total: number } };
      expect($set.spending.total).toBe(6_200_000_000_000);
    });
  });
});

// ── processFiscalYear sovereign auction hook ──────────────────────────────────

describe("processFiscalYear — sovereign auction evaluation hook", () => {
  it("calls evaluateSovereignAuctionForCountry once per processed country budget", async () => {
    const { evaluateSovereignAuctionForCountry } =
      await import("@/lib/sovereignDefault/crisisDetection");
    vi.mocked(evaluateSovereignAuctionForCountry).mockClear();

    const db = makeDb({
      federalBudgets: [
        makeFederalBudget({ _id: "federal", countryId: "US" }),
        makeFederalBudget({ _id: "UK", countryId: "UK" }),
      ],
    });

    await processFiscalYear(db as unknown as Db, 2026, 600);

    expect(evaluateSovereignAuctionForCountry).toHaveBeenCalledTimes(2);
    const countryArgs = vi.mocked(evaluateSovereignAuctionForCountry).mock.calls.map((c) => c[1]);
    expect(countryArgs).toEqual(expect.arrayContaining(["US", "UK"]));
    // currentTurn should be the third arg in every call
    expect(vi.mocked(evaluateSovereignAuctionForCountry).mock.calls[0][2]).toBe(600);
    // realtimeMs should be a number
    expect(typeof vi.mocked(evaluateSovereignAuctionForCountry).mock.calls[0][3]).toBe("number");
  });

  it("does not abort the loop if one country's evaluation throws", async () => {
    const { evaluateSovereignAuctionForCountry } =
      await import("@/lib/sovereignDefault/crisisDetection");
    vi.mocked(evaluateSovereignAuctionForCountry).mockReset();
    vi.mocked(evaluateSovereignAuctionForCountry)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(null);

    const db = makeDb({
      federalBudgets: [
        makeFederalBudget({ _id: "federal", countryId: "US" }),
        makeFederalBudget({ _id: "UK", countryId: "UK" }),
      ],
    });

    // Should not throw despite first call rejecting
    await expect(processFiscalYear(db as unknown as Db, 2026, 600)).resolves.toBeUndefined();
    expect(evaluateSovereignAuctionForCountry).toHaveBeenCalledTimes(2);
  });
});
