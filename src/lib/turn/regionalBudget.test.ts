import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { SUBSIDY_COST_MULTIPLIER } from "@/lib/subsidies/subsidyBudgetCosts";
import {
  calculateRegionalBudget,
  driftValueBase,
  processRegionalBudgets,
  type BudgetCalculationInput,
} from "./regionalBudget";

// ── Pure function tests ──────────────────────────────────────────────────────

describe("calculateRegionalBudget", () => {
  it("calculates revenue from council tax, business rates, and Westminster grant", () => {
    const input: BudgetCalculationInput = {
      councilTaxRate: 0.015, // 1.5%
      businessRate: 0.5, // 50%
      propertyValuePerCapita: 120_000,
      commercialValuePerCapita: 45_000,
      regionPopulation: 1_000_000,
      westminsterGrantPerCapita: 1700,
      nationalPopulation: 67_000_000,
      chancellorAllocation: null,
    };

    const result = calculateRegionalBudget(input);

    // Council tax: 0.015 × 120,000 × 1,000,000 = 1,800,000,000
    expect(result.councilTaxRevenue).toBe(1_800_000_000);
    // Business rates: 0.5 × 45,000 × 1,000,000 = 22,500,000,000
    expect(result.businessRatesRevenue).toBe(22_500_000_000);
    // Westminster grant: 1700 × 67,000,000 / 12 = 9,491,666,666.67
    expect(result.westminsterGrant).toBeCloseTo(9_491_666_666.67, 0);
    // Total = sum of all three
    expect(result.totalBudget).toBeCloseTo(
      result.councilTaxRevenue + result.businessRatesRevenue + result.westminsterGrant,
      0
    );
  });

  it("uses chancellor allocation when provided instead of even split", () => {
    const input: BudgetCalculationInput = {
      councilTaxRate: 0.01,
      businessRate: 0.4,
      propertyValuePerCapita: 100_000,
      commercialValuePerCapita: 40_000,
      regionPopulation: 500_000,
      westminsterGrantPerCapita: 1700,
      nationalPopulation: 67_000_000,
      chancellorAllocation: 5_000_000_000, // Fixed amount
    };

    const result = calculateRegionalBudget(input);

    expect(result.westminsterGrant).toBe(5_000_000_000);
    expect(result.totalBudget).toBe(
      result.councilTaxRevenue + result.businessRatesRevenue + 5_000_000_000
    );
  });

  it("returns zero revenues when rates are zero", () => {
    const input: BudgetCalculationInput = {
      councilTaxRate: 0,
      businessRate: 0,
      propertyValuePerCapita: 120_000,
      commercialValuePerCapita: 45_000,
      regionPopulation: 1_000_000,
      westminsterGrantPerCapita: 0,
      nationalPopulation: 67_000_000,
      chancellorAllocation: null,
    };

    const result = calculateRegionalBudget(input);

    expect(result.councilTaxRevenue).toBe(0);
    expect(result.businessRatesRevenue).toBe(0);
    expect(result.westminsterGrant).toBe(0);
    expect(result.totalBudget).toBe(0);
  });
});

describe("driftValueBase", () => {
  const baseline = 100_000;

  it("drifts toward target at 0.3% per turn when not in deficit", () => {
    const current = 100_000;
    const targetMultiplier = 1.3; // target = 130,000
    const result = driftValueBase(current, baseline, targetMultiplier, false);

    // newValue = 100,000 + (130,000 - 100,000) * 0.003 = 100,090
    expect(result).toBeCloseTo(100_090, 0);
  });

  it("drifts faster (0.5%) when in deficit", () => {
    const current = 100_000;
    const targetMultiplier = 0.7; // target = 70,000
    const result = driftValueBase(current, baseline, targetMultiplier, true);

    // newValue = 100,000 + (70,000 - 100,000) * 0.005 = 99,850
    expect(result).toBeCloseTo(99_850, 0);
  });

  it("clamps at floor (25% of baseline)", () => {
    const current = 26_000; // already near floor
    const targetMultiplier = 0.1; // target = 10,000 (below floor)
    const result = driftValueBase(current, baseline, targetMultiplier, true);

    // Floor = 25,000; drift would go lower but gets clamped
    expect(result).toBeGreaterThanOrEqual(25_000);
  });

  it("clamps at ceiling (300% of baseline)", () => {
    const current = 295_000; // near ceiling
    const targetMultiplier = 5.0; // target = 500,000 (above ceiling)
    const result = driftValueBase(current, baseline, targetMultiplier, false);

    // Ceiling = 300,000
    expect(result).toBeLessThanOrEqual(300_000);
  });

  it("returns current value when already at target", () => {
    const current = 130_000;
    const targetMultiplier = 1.3; // target = 130,000
    const result = driftValueBase(current, baseline, targetMultiplier, false);

    // Distance is zero so no drift
    expect(result).toBe(130_000);
  });
});

// ── Integration-style tests with MockDb ──────────────────────────────────────

describe("processRegionalBudgets", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns 0 regions when there are no UK regions", async () => {
    // states.find returns empty array (default mock behavior)
    const result = await processRegionalBudgets(db as never, 10);
    expect(result).toEqual({ regionsProcessed: 0 });
  });

  it("detects deficit when spending exceeds revenue", async () => {
    // Pre-create collection mocks by accessing them (lazy creation)
    db.collection("states");
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("regionalBudgets");

    const statesColl = db.collectionMocks["states"]!;
    const statePoliciesColl = db.collectionMocks["statePolicies"]!;
    const legTypesColl = db.collectionMocks["legislationTypes"]!;
    const budgetsColl = db.collectionMocks["regionalBudgets"]!;

    // Mock UK region
    statesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "LON", countryId: "UK", population: 9_000_000 }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    // Mock regional policies: council tax at 1.5% rate, plus a spending policy
    const findCallCount = { count: 0 };
    statePoliciesColl.find.mockImplementation(() => {
      findCallCount.count++;
      // First call: regional policies (UK_*), second call: national policies (uk_national)
      if (findCallCount.count === 1) {
        return {
          toArray: vi.fn().mockResolvedValue([
            {
              stateId: "LON",
              legislationTypeId: "uk_council_tax",
              policyOptionId: "uk_council_tax_opt_5",
              policyOptionIndex: 5,
            },
            {
              stateId: "LON",
              legislationTypeId: "uk_nhs_funding",
              policyOptionId: "uk_nhs_funding_opt_0",
              policyOptionIndex: 0,
            },
          ]),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      }
      // National policies
      return {
        toArray: vi.fn().mockResolvedValue([
          {
            stateId: "uk_national",
            legislationTypeId: "uk_local_government_funding",
            policyOptionId: "uk_local_government_funding_opt_3",
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });

    // Mock legislation types
    legTypesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "uk_council_tax",
          policyOptions: [{ id: "uk_council_tax_opt_5", rate: 1.5 }],
        },
        {
          _id: "uk_local_government_funding",
          policyOptions: [{ id: "uk_local_government_funding_opt_3", annualCostPerCapita: 1700 }],
        },
        {
          _id: "uk_nhs_funding",
          policyOptions: [
            // Very expensive option — will create deficit
            { id: "uk_nhs_funding_opt_0", annualCostPerCapita: 999_999 },
          ],
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    // No existing budgets
    budgetsColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await processRegionalBudgets(db as never, 10);
    expect(result).toEqual({ regionsProcessed: 1 });

    // Verify budget was upserted with deficit state (now via batched bulkWrite)
    expect(budgetsColl.bulkWrite).toHaveBeenCalledTimes(1);
    const setData = budgetsColl.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(setData.isOverBudget).toBe(true);
    expect(setData.surplus).toBeLessThan(0);
    expect(setData.turnsOverBudget).toBe(1);
  });

  it("resets turnsOverBudget to 0 when in surplus", async () => {
    db.collection("states");
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("regionalBudgets");

    const statesColl = db.collectionMocks["states"]!;
    const statePoliciesColl = db.collectionMocks["statePolicies"]!;
    const legTypesColl = db.collectionMocks["legislationTypes"]!;
    const budgetsColl = db.collectionMocks["regionalBudgets"]!;

    statesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "LON", countryId: "UK", population: 1_000_000 }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    // No regional policies (no spending, no taxes) but Westminster grant exists
    const findCallCount = { count: 0 };
    statePoliciesColl.find.mockImplementation(() => {
      findCallCount.count++;
      if (findCallCount.count === 1) {
        return {
          toArray: vi.fn().mockResolvedValue([]),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      }
      return {
        toArray: vi.fn().mockResolvedValue([
          {
            stateId: "uk_national",
            legislationTypeId: "uk_local_government_funding",
            policyOptionId: "opt_3",
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
          _id: "uk_local_government_funding",
          policyOptions: [{ id: "opt_3", annualCostPerCapita: 1700 }],
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    // Existing budget was previously over budget
    budgetsColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "LON",
          turnsOverBudget: 3,
          propertyValuePerCapita: 120_000,
          commercialValuePerCapita: 45_000,
          propertyValueBaseline: 120_000,
          commercialValueBaseline: 45_000,
          chancellorAllocation: null,
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processRegionalBudgets(db as never, 10);

    const setData = budgetsColl.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    // No spending at all, so surplus should be positive (Westminster grant only)
    expect(setData.isOverBudget).toBe(false);
    expect(setData.turnsOverBudget).toBe(0);
    expect(setData.surplus).toBeGreaterThan(0);
  });

  it("includes active subsidy costs in persisted regional spending totals", async () => {
    db.collection("states");
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("regionalBudgets");
    db.collection("subsidies");
    db.collection("corporations");
    db.collection("corporateSectors");

    const statesColl = db.collectionMocks["states"]!;
    const statePoliciesColl = db.collectionMocks["statePolicies"]!;
    const legTypesColl = db.collectionMocks["legislationTypes"]!;
    const budgetsColl = db.collectionMocks["regionalBudgets"]!;
    const subsidiesColl = db.collectionMocks["subsidies"]!;
    const corpsColl = db.collectionMocks["corporations"]!;
    const sectorsColl = db.collectionMocks["corporateSectors"]!;

    statesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "SCO", countryId: "UK", population: 1_000_000 }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const findCallCount = { count: 0 };
    statePoliciesColl.find.mockImplementation(() => {
      findCallCount.count++;
      if (findCallCount.count === 1) {
        return {
          toArray: vi.fn().mockResolvedValue([
            {
              stateId: "SCO",
              legislationTypeId: "uk_local_health",
              policyOptionId: "health_center",
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
            stateId: "uk_national",
            legislationTypeId: "uk_local_government_funding",
            policyOptionId: "grant_center",
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
          _id: "uk_local_government_funding",
          policyOptions: [{ id: "grant_center", annualCostPerCapita: 1700 }],
        },
        {
          _id: "uk_local_health",
          policyDomain: "healthcare",
          policyOptions: [{ id: "health_center", annualCostPerCapita: 100 }],
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

    subsidiesColl.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "subsidy_1",
          countryId: "UK",
          scope: "state",
          stateId: "SCO",
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
          { _id: "corp_1", headquartersState: "SCO", countryId: "UK", liquidCurrencyCode: "GBP" },
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
          stateId: "SCO",
          countryId: "UK",
          sectorType: "technology",
          revenue: 500_000,
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processRegionalBudgets(db as never, 10);

    const setData = budgetsColl.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    // 500_000 revenue × TURNS_PER_YEAR × SUBSIDY_COST_MULTIPLIER (0.105) = 2_520_000.
    const expectedSubsidy = 500_000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER;
    expect(setData.subsidyCosts).toBe(expectedSubsidy);
    // enactedBillCosts = 100M enacted law cost + the subsidy line.
    expect(setData.enactedBillCosts).toBe(100_000_000 + expectedSubsidy);
    expect(setData.surplus).toBeLessThan(setData.totalBudget - 100_000_000);
  });
});
