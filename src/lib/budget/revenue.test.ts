import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  applyGrowthToFederalBases,
  applyPerTurnGrowthToFederalBases,
  applyPerTurnGrowthToStateBases,
  applyGrowthToStateBases,
  computeTaxBaseGdpShareBaseline,
  type TaxBaseGravityContext,
} from "./revenue";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// Stub out public-enterprise revenue so it doesn't pull in live DB state during tests.
vi.mock("./publicEnterpriseRevenue", () => ({
  calculateCountryOwnedBudgetRevenue: vi.fn().mockResolvedValue({ healthcareIncome: 0, other: 0 }),
}));
// Stub calculateFederalSpending so refreshNationalBudgetRevenue tests (if added later) don't crash.
vi.mock("./spending", () => ({
  calculateFederalSpending: vi
    .fn()
    .mockResolvedValue({ byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 }),
}));

describe("per-turn vs annual tax-base growth", () => {
  const factors = {
    gdpGrowth: 2.5,
    wageGrowth: 3,
    inflationRate: 2,
    tradeGrowth: 2,
    lastUpdated: new Date(0),
  };
  const fed = {
    taxableIncome: 1000,
    wagesAndSalaries: 1000,
    domesticCorporateProfits: 500,
    foreignCorporateProfits: 200,
    importValue: 400,
    taxableSales: 800,
  };
  const state = {
    taxableIncome: 100,
    taxableSales: 80,
    domesticCorporateProfits: 50,
    foreignCorporateProfits: 20,
    propertyValue: 300,
  };

  it("applies a single 1/TURNS_PER_YEAR slice per turn (federal)", () => {
    const out = applyPerTurnGrowthToFederalBases(fed, factors);
    expect(out.taxableIncome).toBeCloseTo(1000 * (1 + 3 / 100 / TURNS_PER_YEAR), 9);
    expect(out.importValue).toBeCloseTo(400 * (1 + 2 / 100 / TURNS_PER_YEAR), 9);
  });

  it("compounds over TURNS_PER_YEAR turns to ≈ the annual federal step", () => {
    let bases = fed;
    for (let i = 0; i < TURNS_PER_YEAR; i++)
      bases = applyPerTurnGrowthToFederalBases(bases, factors);
    const annual = applyGrowthToFederalBases(fed, factors);
    // (1 + r/n)^n ≈ 1 + r (slightly higher from compounding) — within ~0.1%.
    expect(bases.taxableIncome).toBeGreaterThan(annual.taxableIncome);
    expect(bases.taxableIncome / annual.taxableIncome).toBeCloseTo(1, 2);
  });

  it("compounds over TURNS_PER_YEAR turns to ≈ the annual state step", () => {
    let bases = state;
    for (let i = 0; i < TURNS_PER_YEAR; i++) bases = applyPerTurnGrowthToStateBases(bases, factors);
    const annual = applyGrowthToStateBases(state, factors);
    expect(bases.taxableIncome / annual.taxableIncome).toBeCloseTo(1, 2);
    expect(bases.propertyValue / annual.propertyValue).toBeCloseTo(1, 2);
  });
});

describe("computeTaxBaseGdpShareBaseline", () => {
  const fed = {
    taxableIncome: 1000,
    wagesAndSalaries: 2000,
    domesticCorporateProfits: 500,
    foreignCorporateProfits: 200,
    importValue: 400,
    taxableSales: 800,
  };

  it("records each base's share of the given GDP", () => {
    const baseline = computeTaxBaseGdpShareBaseline(fed, 10_000);
    expect(baseline.taxableIncome).toBeCloseTo(0.1, 9);
    expect(baseline.wagesAndSalaries).toBeCloseTo(0.2, 9);
    expect(baseline.domesticCorporateProfits).toBeCloseTo(0.05, 9);
  });

  it("returns an empty baseline for a non-positive GDP (retried next turn by the caller)", () => {
    expect(computeTaxBaseGdpShareBaseline(fed, 0)).toEqual({});
    expect(computeTaxBaseGdpShareBaseline(fed, -5)).toEqual({});
  });

  it("skips zero/negative base values (nothing meaningful to anchor)", () => {
    const baseline = computeTaxBaseGdpShareBaseline({ ...fed, foreignCorporateProfits: 0 }, 10_000);
    expect(baseline.foreignCorporateProfits).toBeUndefined();
  });
});

describe("tax-base GDP-share gravity (fiscal-divergence guardrail)", () => {
  const factors = {
    gdpGrowth: 2.5,
    wageGrowth: 3,
    inflationRate: 2,
    tradeGrowth: 2,
    lastUpdated: new Date(0),
  };
  const fed = {
    taxableIncome: 1000,
    wagesAndSalaries: 1000,
    domesticCorporateProfits: 500,
    foreignCorporateProfits: 200,
    importValue: 400,
    taxableSales: 800,
  };

  it("omitted gravity leaves growth byte-identical to the pre-guardrail behavior", () => {
    const withoutArg = applyPerTurnGrowthToFederalBases(fed, factors);
    const withUndefined = applyPerTurnGrowthToFederalBases(fed, factors, undefined);
    expect(withUndefined).toEqual(withoutArg);
  });

  it("pulls a base that has drifted ABOVE its baseline share back down", () => {
    // wagesAndSalaries is already 2x its baseline share of currentGdp (as if
    // wageGrowth had been compounding away from GDP for a long time).
    const gravity: TaxBaseGravityContext = {
      currentGdp: 10_000,
      shareBaseline: { wagesAndSalaries: 0.05 }, // target = 500, base is 1000
    };
    const grownNoGravity = applyPerTurnGrowthToFederalBases(fed, factors);
    const grownWithGravity = applyPerTurnGrowthToFederalBases(fed, factors, gravity);
    expect(grownWithGravity.wagesAndSalaries).toBeLessThan(grownNoGravity.wagesAndSalaries);
  });

  it("pulls a base that has fallen BELOW its baseline share back up", () => {
    const gravity: TaxBaseGravityContext = {
      currentGdp: 10_000,
      shareBaseline: { wagesAndSalaries: 0.5 }, // target = 5000, base is 1000
    };
    const grownNoGravity = applyPerTurnGrowthToFederalBases(fed, factors);
    const grownWithGravity = applyPerTurnGrowthToFederalBases(fed, factors, gravity);
    expect(grownWithGravity.wagesAndSalaries).toBeGreaterThan(grownNoGravity.wagesAndSalaries);
  });

  it("leaves a base untouched when it has no baseline share recorded", () => {
    const gravity: TaxBaseGravityContext = {
      currentGdp: 10_000,
      shareBaseline: { wagesAndSalaries: 0.05 }, // importValue has no entry
    };
    const grownNoGravity = applyPerTurnGrowthToFederalBases(fed, factors);
    const grownWithGravity = applyPerTurnGrowthToFederalBases(fed, factors, gravity);
    expect(grownWithGravity.importValue).toBeCloseTo(grownNoGravity.importValue, 9);
  });

  it("is a no-op when currentGdp is non-positive", () => {
    const gravity: TaxBaseGravityContext = {
      currentGdp: 0,
      shareBaseline: { wagesAndSalaries: 0.05 },
    };
    const grownNoGravity = applyPerTurnGrowthToFederalBases(fed, factors);
    const grownWithGravity = applyPerTurnGrowthToFederalBases(fed, factors, gravity);
    expect(grownWithGravity).toEqual(grownNoGravity);
  });
});

describe("calculateNationalGDP (A1 SSOT — Σ state.gdp)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function wire(states: unknown[], federalBudget: unknown) {
    db.collectionMocks.states = {
      ...db.collectionMocks.states,
      // Honor the countryId filter the query now applies DB-side (was a global
      // find({}) + JS-side countryId filter before; the scoping moved into the
      // query). Mirrors real Mongo so the "no states for this country" fallback
      // is actually exercised.
      find: vi.fn().mockImplementation((filter?: { countryId?: string }) => {
        const scoped =
          filter?.countryId != null
            ? (states as Array<{ countryId?: string }>).filter(
                (s) => s.countryId === filter.countryId
              )
            : states;
        return { toArray: vi.fn().mockResolvedValue(scoped) };
      }),
    } as typeof db.collectionMocks.states;
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue(federalBudget),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)
  }

  it("returns Σ state.gdp × 1M for the country, ignoring a stale federalBudget.gdp", async () => {
    wire(
      [
        { _id: "us1", countryId: "US", gdp: 1000 },
        { _id: "us2", countryId: "US", gdp: 2000 },
        { _id: "federal", countryId: "US", gdp: 9999 }, // national-scope synthetic → excluded
        { _id: "uk1", countryId: "UK", gdp: 5000 }, // foreign → excluded
      ],
      { _id: "federal", countryId: "US", gdp: 5_000_000_000_000 } // stale 5T → must be ignored
    );
    const { calculateNationalGDP } = await import("./revenue");
    // (1000 + 2000) million × 1M = 3,000,000,000
    expect(await calculateNationalGDP(db as unknown as Db)).toBe(3_000_000_000);
  });

  it("falls back to federalBudget.gdp when the country has no states", async () => {
    wire([{ _id: "uk1", countryId: "UK", gdp: 5000 }], {
      _id: "federal",
      countryId: "US",
      gdp: 7_000_000_000_000,
    });
    const { calculateNationalGDP } = await import("./revenue");
    expect(await calculateNationalGDP(db as unknown as Db)).toBe(7_000_000_000_000);
  });

  it("falls back to the $27T constant when there are no states and no budget gdp", async () => {
    wire([], { _id: "federal", countryId: "US" });
    const { calculateNationalGDP } = await import("./revenue");
    expect(await calculateNationalGDP(db as unknown as Db)).toBe(27_000_000_000_000);
  });
});

describe("calculateFederalRevenue", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("computes domestic and foreign corporate tax separately from their split bases", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        taxBases: {
          taxableIncome: 1_000_000,
          domesticCorporateProfits: 600_000,
          foreignCorporateProfits: 200_000,
          wagesAndSalaries: 500_000,
          importValue: 100_000,
          taxableSales: 800_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // Rewire the collection-returning mock so findOne picks up our override.
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 10,
        domesticCorporateTax: 20,
        foreignCorporateTax: 35,
        payrollTax: 7.65,
        tariffs: 0,
        salesTax: 0,
      },
      "federal"
    );

    expect(revenue.domesticCorporateTax).toBe(600_000 * 0.2);
    expect(revenue.foreignCorporateTax).toBe(200_000 * 0.35);
    expect(revenue.total).toBeGreaterThan(
      revenue.domesticCorporateTax + revenue.foreignCorporateTax
    );
  });

  it("falls back to split GDP factors when taxBases are missing", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        gdp: 10_000_000,
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // calculateNationalGDP (A1) reads states first; empty states → falls back to
    // the budget gdp (10M) this test exercises.
    db.collectionMocks.states = {
      ...db.collectionMocks.states,
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as typeof db.collectionMocks.states;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 10,
        foreignCorporateTax: 20,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
      },
      "federal"
    );

    // 6% of 10M = 600_000 domestic; 2% = 200_000 foreign
    expect(revenue.domesticCorporateTax).toBeCloseTo(600_000 * 0.1, 5);
    expect(revenue.foreignCorporateTax).toBeCloseTo(200_000 * 0.2, 5);
  });

  it("adds DE Solidaritätszuschlag as a surcharge on income tax revenue", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "DE",
        countryId: "DE",
        taxBases: {
          taxableIncome: 1_000_000,
          domesticCorporateProfits: 0,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 0,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 42,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        solidaritySurcharge: 5.5,
      },
      "DE"
    );

    // 1M × 42% = 420k incomeTax; 420k × 5.5% = 23.1k Soli
    expect(revenue.incomeTax).toBe(420_000);
    expect(revenue.solidaritySurcharge).toBeCloseTo(420_000 * 0.055, 5);
  });

  it("omits Solidaritätszuschlag when the rate is undefined (non-DE countries)", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        taxBases: {
          taxableIncome: 1_000_000,
          domesticCorporateProfits: 0,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 0,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 30,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
      },
      "federal"
    );

    // No Soli rate set → Soli revenue is 0 (or absent in the total)
    expect(revenue.solidaritySurcharge ?? 0).toBe(0);
  });

  it("backfills split corporate tax rates from legacy corporateTax fields", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        taxBases: {
          taxableIncome: 1_000_000,
          domesticCorporateProfits: 600_000,
          foreignCorporateProfits: 200_000,
          wagesAndSalaries: 500_000,
          importValue: 100_000,
          taxableSales: 800_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 10,
        corporateTax: 21,
        payrollTax: 7.65,
        tariffs: 0,
        salesTax: 0,
      } as never,
      "federal"
    );

    expect(revenue.domesticCorporateTax).toBe(600_000 * 0.21);
    expect(revenue.foreignCorporateTax).toBe(200_000 * 0.21);
  });

  it("computes CN LVAT from a real-estate share of domestic corporate profits", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "CN",
        countryId: "CN",
        taxBases: {
          taxableIncome: 0,
          domesticCorporateProfits: 10_000_000,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 0,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        landValueAddedTax: 40,
      },
      "CN"
    );

    // 5% of 10M = 500_000 real-estate base; × 40% LVAT = 200_000
    expect(revenue.landValueAddedTax).toBeCloseTo(200_000, 0);
  });

  it("computes CN UMCT as surcharge on VAT (salesTax) revenue", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "CN",
        countryId: "CN",
        taxBases: {
          taxableIncome: 0,
          domesticCorporateProfits: 0,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 10_000_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 13,
        urbanMaintenanceTax: 7,
      },
      "CN"
    );

    // 10M × 13% = 1.3M VAT revenue; × 7% UMCT = 91_000
    expect(revenue.urbanMaintenanceTax).toBeCloseTo(91_000, 0);
  });

  it("computes CN Stamp Duty from a GDP-derived documented-transactions base", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "CN",
        countryId: "CN",
        gdp: 100_000_000_000,
        taxBases: {
          taxableIncome: 0,
          domesticCorporateProfits: 0,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 0,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        stampDuty: 0.05,
      },
      "CN"
    );

    // 2% of 100B = 2B documented-transactions base; × 0.05% = 1M
    expect(revenue.stampDuty).toBeCloseTo(1_000_000, 0);
  });

  it("omits CN-specific taxes when their rates are undefined (non-CN countries)", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        gdp: 100_000_000_000,
        taxBases: {
          taxableIncome: 1_000_000,
          domesticCorporateProfits: 10_000_000,
          foreignCorporateProfits: 0,
          wagesAndSalaries: 0,
          importValue: 0,
          taxableSales: 5_000_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 30,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 13,
      },
      "federal"
    );

    expect(revenue.landValueAddedTax ?? 0).toBe(0);
    expect(revenue.urbanMaintenanceTax ?? 0).toBe(0);
    expect(revenue.stampDuty ?? 0).toBe(0);
  });
});

describe("calculateStateRevenue", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("computes domestic and foreign corp tax from split state bases", async () => {
    db.collectionMocks.stateBudgets = {
      ...db.collectionMocks.stateBudgets,
      findOne: vi.fn().mockResolvedValue({
        _id: "US_CA",
        taxBases: {
          taxableIncome: 400_000,
          taxableSales: 500_000,
          domesticCorporateProfits: 300_000,
          foreignCorporateProfits: 100_000,
          propertyValue: 1_000_000,
        },
        revenue: { other: 0 },
      }),
    } as typeof db.collectionMocks.stateBudgets;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateStateRevenue } = await import("./revenue");
    const revenue = await calculateStateRevenue(
      db as unknown as Db,
      "US_CA",
      "US",
      {
        incomeTax: 5,
        salesTax: 6,
        domesticCorporateTax: 8,
        foreignCorporateTax: 15,
        propertyTax: 1,
      },
      0
    );

    expect(revenue.domesticCorporateTax).toBe(300_000 * 0.08);
    expect(revenue.foreignCorporateTax).toBe(100_000 * 0.15);
  });

  it("computes DE Gewerbesteuer from Hebesatz × Steuermesszahl × corporate-profit base", async () => {
    db.collectionMocks.stateBudgets = {
      ...db.collectionMocks.stateBudgets,
      findOne: vi.fn().mockResolvedValue({
        _id: "DE_BW",
        taxBases: {
          taxableIncome: 0,
          taxableSales: 0,
          domesticCorporateProfits: 1_000_000,
          foreignCorporateProfits: 0,
          propertyValue: 0,
        },
        revenue: { other: 0 },
      }),
    } as typeof db.collectionMocks.stateBudgets;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateStateRevenue } = await import("./revenue");
    const revenue = await calculateStateRevenue(
      db as unknown as Db,
      "DE_BW",
      "DE",
      {
        incomeTax: 0,
        salesTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        propertyTax: 0,
        tradeTax: 400, // statutory Hebesatz → 14% effective
      },
      0
    );

    // 1M × 0.035 (Steuermesszahl) × 400/100 = 1M × 0.14 = 140k
    expect(revenue.tradeTax).toBeCloseTo(1_000_000 * 0.035 * (400 / 100), 5);
  });

  it("treats missing split state corporate tax rates as zero instead of NaN", async () => {
    db.collectionMocks.stateBudgets = {
      ...db.collectionMocks.stateBudgets,
      findOne: vi.fn().mockResolvedValue({
        _id: "US_CA",
        taxBases: {
          taxableIncome: 400_000,
          taxableSales: 500_000,
          domesticCorporateProfits: 300_000,
          foreignCorporateProfits: 100_000,
          propertyValue: 1_000_000,
        },
        revenue: { other: 0 },
      }),
    } as typeof db.collectionMocks.stateBudgets;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateStateRevenue } = await import("./revenue");
    const revenue = await calculateStateRevenue(
      db as unknown as Db,
      "US_CA",
      "US",
      {
        incomeTax: 5,
        salesTax: 6,
        propertyTax: 1,
      } as never,
      0
    );

    expect(revenue.domesticCorporateTax).toBe(0);
    expect(revenue.foreignCorporateTax).toBe(0);
    expect(Number.isNaN(revenue.total)).toBe(false);
  });
});

describe("calculateFederalRevenue — IE-specific tax types", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  const setIeBudget = () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "ie",
        countryId: "IE",
        gdp: 500_000_000_000,
        taxBases: {
          taxableIncome: 200_000_000_000,
          domesticCorporateProfits: 100_000_000_000,
          foreignCorporateProfits: 80_000_000_000,
          wagesAndSalaries: 200_000_000_000,
          importValue: 50_000_000_000,
          taxableSales: 150_000_000_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)
  };

  it("computes universalSocialCharge proportional to wages base", async () => {
    setIeBudget();
    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        universalSocialCharge: 8,
      } as never,
      "ie"
    );
    expect(revenue.universalSocialCharge).toBe(200_000_000_000 * 0.08);
  });

  it("computes capitalGainsTax against 3%-of-GDP base", async () => {
    setIeBudget();
    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        capitalGainsTax: 33,
      } as never,
      "ie"
    );
    // gdp × 0.03 × rate/100 = 500B × 0.03 × 0.33 = 4.95B
    expect(revenue.capitalGainsTax).toBeCloseTo(4_950_000_000, -3);
  });

  it("computes exciseDuty as a multiplier on 1.5%-of-GDP base (100 = baseline)", async () => {
    setIeBudget();
    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        exciseDuty: 100,
      } as never,
      "ie"
    );
    // gdp × 0.015 × 100/100 = 500B × 0.015 = 7.5B
    expect(revenue.exciseDuty).toBeCloseTo(7_500_000_000, -3);
  });

  it("computes propertyTax (IE LPT) against the 0.5×-of-GDP residential property base", async () => {
    setIeBudget();
    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 0,
        domesticCorporateTax: 0,
        foreignCorporateTax: 0,
        payrollTax: 0,
        tariffs: 0,
        salesTax: 0,
        propertyTax: 0.18,
      } as never,
      "ie"
    );
    // gdp × 0.5 × 0.18/100 = 500B × 0.5 × 0.0018 = 450M
    expect(revenue.propertyTax).toBeCloseTo(450_000_000, -3);
  });

  it("leaves USC/CGT/Excise/LPT undefined-or-zero for non-IE countries", async () => {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue({
        _id: "federal",
        countryId: "US",
        gdp: 27_000_000_000_000,
        taxBases: {
          taxableIncome: 10_000_000_000_000,
          domesticCorporateProfits: 5_000_000_000_000,
          foreignCorporateProfits: 1_000_000_000_000,
          wagesAndSalaries: 8_000_000_000_000,
          importValue: 3_000_000_000_000,
          taxableSales: 12_000_000_000_000,
        },
        revenue: { healthcareIncome: 0, other: 0 },
      }),
    } as typeof db.collectionMocks.federalBudget;
    // (removed redundant collection override: MockDb's default lazily creates
    // unwired collections — required since calculateFederalRevenue reads enactedLaws)

    const { calculateFederalRevenue } = await import("./revenue");
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      {
        incomeTax: 20,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
      "federal"
    );
    expect(revenue.universalSocialCharge ?? 0).toBe(0);
    expect(revenue.capitalGainsTax ?? 0).toBe(0);
    expect(revenue.exciseDuty ?? 0).toBe(0);
    expect(revenue.propertyTax ?? 0).toBe(0);
  });
});

describe("calculateFederalRevenue 'other' fallback (audit P1)", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  const budget = (other: number | undefined) =>
    ({
      _id: "federal",
      countryId: "us",
      revenue: other === undefined ? {} : { other },
    }) as unknown as import("@/lib/db/types/budget").FederalBudget;

  it("respects an explicit revenue.other of 0 (no phantom 200B)", async () => {
    const { calculateFederalRevenue } = await import("./revenue");
    const result = await calculateFederalRevenue(db as unknown as Db, null, "federal", budget(0));
    expect(result.other).toBe(0);
  });

  it("still defaults to 200B when revenue.other is absent", async () => {
    const { calculateFederalRevenue } = await import("./revenue");
    const result = await calculateFederalRevenue(
      db as unknown as Db,
      null,
      "federal",
      budget(undefined)
    );
    expect(result.other).toBe(200000000000);
  });
});
