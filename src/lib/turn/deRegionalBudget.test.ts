import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { SUBSIDY_COST_MULTIPLIER } from "@/lib/subsidies/subsidyBudgetCosts";
import { calculateDERegionalBudget, processDERegionalBudgets } from "./deRegionalBudget";

describe("calculateDERegionalBudget", () => {
  it("sums all four revenue sources into totalBudget", () => {
    const result = calculateDERegionalBudget({
      incomeTaxRate: 42,
      vatRate: 19,
      tradeTaxHebesatz: 400,
      medianIncome: 35_000,
      gdpPerCapita: 45_000,
      regionPopulation: 1_000_000,
      nationalPopulation: 80_000_000,
      ministerAllocation: null,
    });

    expect(result.totalBudget).toBe(
      result.incomeTaxShare +
        result.vatShare +
        result.tradeTaxRevenue +
        result.federalEqualizationGrant
    );
  });

  it("scales Gewerbesteuer revenue with the Hebesatz", () => {
    const base = {
      incomeTaxRate: 42,
      vatRate: 19,
      medianIncome: 35_000,
      gdpPerCapita: 45_000,
      regionPopulation: 1_000_000,
      nationalPopulation: 80_000_000,
      ministerAllocation: null,
    };

    const statutory = calculateDERegionalBudget({ ...base, tradeTaxHebesatz: 400 });
    const doubled = calculateDERegionalBudget({ ...base, tradeTaxHebesatz: 800 });

    // Double the Hebesatz → double the tradeTax revenue (linear)
    expect(doubled.tradeTaxRevenue).toBeCloseTo(statutory.tradeTaxRevenue * 2, 0);
  });

  // Fiscal-scale audit, 2026-07-28: `regionCount`/`grantPerCapita` default to
  // the modern constants (DE_REGION_COUNT=16 / DEFAULT_FEDERAL_GRANT_PER_CAPITA
  // =500) when omitted, so every pre-existing caller (including the two tests
  // above) sees byte-identical behavior. Era-aware callers (processDERegional
  // Budgets, threaded from `getCountryConfig("DE", preset)`) can now override
  // both — this is what fixes the 1953 preset's federal-equalization pool,
  // which was ~5x too large (a flat modern-EUR-per-capita constant applied to
  // a 1953 DEM-denominated economy, plus a hardcoded 16-region split against
  // only 11 actually-seeded 1953 Länder).
  it("omitting regionCount/grantPerCapita preserves the modern 16-region / 500-per-capita default", () => {
    const result = calculateDERegionalBudget({
      incomeTaxRate: 42,
      vatRate: 19,
      tradeTaxHebesatz: 400,
      medianIncome: 35_000,
      gdpPerCapita: 45_000,
      regionPopulation: 1_000_000,
      nationalPopulation: 80_000_000,
      ministerAllocation: null,
    });
    // (500 × 80,000,000) / 16 = 2,500,000,000
    expect(result.federalEqualizationGrant).toBeCloseTo(2_500_000_000, -3);
  });

  it("an era-scaled regionCount/grantPerCapita (matching the 1953 preset) shrinks the grant proportionally", () => {
    const modern = calculateDERegionalBudget({
      incomeTaxRate: 42,
      vatRate: 19,
      tradeTaxHebesatz: 400,
      medianIncome: 35_000,
      gdpPerCapita: 45_000,
      regionPopulation: 1_000_000,
      nationalPopulation: 50_820_000,
      ministerAllocation: null,
    });
    const era1953 = calculateDERegionalBudget({
      incomeTaxRate: 42,
      vatRate: 19,
      tradeTaxHebesatz: 400,
      medianIncome: 35_000,
      gdpPerCapita: 45_000,
      regionPopulation: 1_000_000 / 16,
      nationalPopulation: 50_820_000,
      ministerAllocation: null,
      regionCount: 11, // 1953 West Germany's 11 Länder, not the modern 16
      grantPerCapita: 100, // ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"].DE
    });
    // (100 × 50,820,000) / 11 per region × 11 regions = 5,082,000,000 total —
    // ≈ the authored NATIONAL_BUDGET_SEED_CONFIGS_1953.DE.baselineStateGrants
    // ($5B), not the ~17.5B the old flat 500/16 constants produced.
    expect(era1953.federalEqualizationGrant * 11).toBeCloseTo(5_082_000_000, -6);
    expect(era1953.federalEqualizationGrant).toBeLessThan(modern.federalEqualizationGrant);
  });
});

describe("processDERegionalBudgets", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("includes active subsidy costs in Land budget persistence", async () => {
    db.collection("states");
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("regionalBudgets");
    db.collection("stateMetrics");
    db.collection("cabinetSettings");
    db.collection("subsidies");
    db.collection("corporations");
    db.collection("corporateSectors");

    const statesColl = db.collectionMocks["states"]!;
    const statePoliciesColl = db.collectionMocks["statePolicies"]!;
    const legTypesColl = db.collectionMocks["legislationTypes"]!;
    const budgetsColl = db.collectionMocks["regionalBudgets"]!;
    const metricsColl = db.collectionMocks["stateMetrics"]!;
    const subsidiesColl = db.collectionMocks["subsidies"]!;
    const corpsColl = db.collectionMocks["corporations"]!;
    const sectorsColl = db.collectionMocks["corporateSectors"]!;

    statesColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "BE", countryId: "DE", population: 1_000_000, gdp: 60_000 }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    let policyFindCount = 0;
    statePoliciesColl.find.mockImplementation(() => {
      policyFindCount++;
      if (policyFindCount === 1) {
        return {
          toArray: vi.fn().mockResolvedValue([
            {
              stateId: "BE",
              legislationTypeId: "de_regional_health",
              policyOptionId: "de_regional_health_center",
              policyOptionIndex: 0,
            },
          ]),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      }

      return {
        toArray: vi.fn().mockResolvedValue([
          {
            stateId: "de_national",
            legislationTypeId: "de_income_tax_rate",
            policyOptionId: "de_income_tax_center",
          },
          {
            stateId: "de_national",
            legislationTypeId: "de_vat_rate",
            policyOptionId: "de_vat_center",
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });

    legTypesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "de_income_tax_rate",
          policyOptions: [{ id: "de_income_tax_center", rate: 42 }],
        },
        {
          _id: "de_vat_rate",
          policyOptions: [{ id: "de_vat_center", rate: 19 }],
        },
        {
          _id: "de_regional_health",
          policyOptions: [{ id: "de_regional_health_center", annualCostPerCapita: 100 }],
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    budgetsColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    metricsColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "BE", economic: { medianIncome: { value: 35_000 } } }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    subsidiesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "subsidy_1",
          countryId: "DE",
          scope: "state",
          stateId: "BE",
          scopeType: "economy_wide",
          domesticOnly: false,
          active: true,
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    corpsColl.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "corp_1", headquartersState: "BE", countryId: "DE", liquidCurrencyCode: "EUR" },
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    sectorsColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "sector_1",
          corporationId: "corp_1",
          stateId: "BE",
          countryId: "DE",
          sectorType: "technology",
          revenue: 500_000,
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await processDERegionalBudgets(db as never, 10);

    expect(result).toEqual({ regionsProcessed: 1 });
    const update = budgetsColl.bulkWrite.mock.calls[0][0][0].updateOne.update;
    // 500_000 revenue × TURNS_PER_YEAR × SUBSIDY_COST_MULTIPLIER (0.105) = 2_520_000.
    const expectedSubsidy = 500_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER;
    expect(update.$set.subsidyCosts).toBe(expectedSubsidy);
    // enactedBillCosts = 100M enacted law cost + the subsidy line.
    expect(update.$set.enactedBillCosts).toBe(100_000_000 + expectedSubsidy);
  });
});
