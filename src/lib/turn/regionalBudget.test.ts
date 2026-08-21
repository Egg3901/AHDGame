import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { SUBSIDY_COST_MULTIPLIER } from "@/lib/subsidies/subsidyBudgetCosts";
import {
  BUSINESS_RATES_GDP_SHARE,
  COUNCIL_TAX_GDP_SHARE,
  calculateRegionalBudget,
  driftValueBase,
  processRegionalBudgets,
  type BudgetCalculationInput,
} from "./regionalBudget";

// ── Pure function tests ──────────────────────────────────────────────────────

describe("calculateRegionalBudget", () => {
  /** London-scale 1957 figures: £3.44B regional GDP, 9.2M people. */
  const LONDON: BudgetCalculationInput = {
    regionGdp: 3_442_585_781,
    propertyValueIndex: 1,
    commercialValueIndex: 1,
    regionPopulation: 9_206_136,
    nationalPopulation: 57_560_675,
    grantPool: 250_000_000,
    chancellorAllocation: null,
  };

  it("anchors council tax and business rates to regional GDP", () => {
    const result = calculateRegionalBudget(LONDON);

    expect(result.councilTaxRevenue).toBeCloseTo(LONDON.regionGdp * COUNCIL_TAX_GDP_SHARE, 0);
    expect(result.businessRatesRevenue).toBeCloseTo(LONDON.regionGdp * BUSINESS_RATES_GDP_SHARE, 0);
    // The era-scaled result stays inside the region's own economy, unlike the
    // per-capita value bases this replaced (which billed London £18.8B of
    // council tax against a £17.5B national GDP in 1957).
    expect(result.totalBudget).toBeLessThan(LONDON.regionGdp * 0.1);
  });

  it("splits the Westminster grant pool by population share", () => {
    const result = calculateRegionalBudget(LONDON);

    expect(result.westminsterGrant).toBeCloseTo(
      (250_000_000 * 9_206_136) / 57_560_675, // ≈ £40.0M
      0
    );
    expect(result.totalBudget).toBeCloseTo(
      result.councilTaxRevenue + result.businessRatesRevenue + result.westminsterGrant,
      0
    );
  });

  it("scales tax revenue by the drifted value indices", () => {
    const halved = calculateRegionalBudget({
      ...LONDON,
      propertyValueIndex: 0.5,
      commercialValueIndex: 0.5,
    });
    const base = calculateRegionalBudget(LONDON);

    // The austerity feedback loop: eroded value bases must cost the region revenue.
    expect(halved.councilTaxRevenue).toBeCloseTo(base.councilTaxRevenue / 2, 0);
    expect(halved.businessRatesRevenue).toBeCloseTo(base.businessRatesRevenue / 2, 0);
    // The grant is a central transfer — value drift must not touch it.
    expect(halved.westminsterGrant).toBeCloseTo(base.westminsterGrant, 0);
  });

  it("uses the chancellor allocation when provided instead of the population share", () => {
    const result = calculateRegionalBudget({ ...LONDON, chancellorAllocation: 75_000_000 });

    expect(result.westminsterGrant).toBe(75_000_000);
    expect(result.totalBudget).toBeCloseTo(
      result.councilTaxRevenue + result.businessRatesRevenue + 75_000_000,
      0
    );
  });

  it("returns a zero grant rather than NaN when the nation has no population", () => {
    const result = calculateRegionalBudget({ ...LONDON, nationalPopulation: 0 });

    expect(result.westminsterGrant).toBe(0);
    expect(Number.isFinite(result.totalBudget)).toBe(true);
  });

  it("returns zero tax revenue for a region with no measured economy", () => {
    const result = calculateRegionalBudget({ ...LONDON, regionGdp: 0, grantPool: 0 });

    expect(result.councilTaxRevenue).toBe(0);
    expect(result.businessRatesRevenue).toBe(0);
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

  const cursor = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  /** Wire the collections `processRegionalBudgets` reads, RU-test style. */
  function wire({
    regions,
    policies = [],
    legTypes = [],
    existingBudgets = [],
    budget = { _id: "UK", spending: { stateGrants: 250_000_000 } } as unknown,
  }: {
    regions: unknown[];
    policies?: unknown[];
    legTypes?: unknown[];
    existingBudgets?: unknown[];
    budget?: unknown;
  }) {
    // Access each collection first so MockDb lazily creates the full default
    // mock (spreading a not-yet-created entry would lose bulkWrite etc.).
    for (const name of [
      "states",
      "statePolicies",
      "legislationTypes",
      "regionalBudgets",
      "federalBudget",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["states"]!.find.mockImplementation(() => cursor(regions));
    db.collectionMocks["statePolicies"]!.find.mockImplementation(() => cursor(policies));
    db.collectionMocks["legislationTypes"]!.find.mockImplementation(() => cursor(legTypes));
    db.collectionMocks["regionalBudgets"]!.find.mockImplementation(() => cursor(existingBudgets));
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(budget);
  }

  const written = () =>
    db.collectionMocks["regionalBudgets"]!.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;

  it("returns 0 regions when there are no UK regions", async () => {
    // states.find returns empty array (default mock behavior)
    const result = await processRegionalBudgets(db as never, 10);
    expect(result).toEqual({ regionsProcessed: 0 });
  });

  it("funds a region whose legacy UK legislation types no longer exist", async () => {
    // The live 1953 shape: the political-legislation preset unseeds every
    // legacy `uk_*` type, but the region still carries statePolicies pointing
    // at them. Revenue must come from the region's economy, not that lookup.
    wire({
      regions: [{ _id: "LON", countryId: "UK", population: 9_206_136, gdp: 3442.585781 }],
      policies: [
        {
          stateId: "LON",
          scope: "state",
          legislationTypeId: "uk_council_tax",
          policyOptionId: "uk_council_tax_opt_5",
          policyOptionIndex: 5,
        },
      ],
      legTypes: [], // ← the type the policy references is gone
    });

    await processRegionalBudgets(db as never, 267);

    const setData = written();
    expect(setData.councilTaxRevenue).toBeCloseTo(3_442_585_781 * COUNCIL_TAX_GDP_SHARE, -3);
    expect(setData.businessRatesRevenue).toBeCloseTo(3_442_585_781 * BUSINESS_RATES_GDP_SHARE, -3);
    expect(setData.westminsterGrant).toBeGreaterThan(0);
    expect(setData.totalBudget).toBeGreaterThan(0);
  });

  it("falls back to baselineStateGrants when the enacted grant line is zero", async () => {
    // Live UK carries spending.stateGrants = 0 with baselineStateGrants = £250M;
    // reading only the enacted line would leave every region unfunded.
    wire({
      regions: [{ _id: "LON", countryId: "UK", population: 1_000_000, gdp: 1000 }],
      budget: { _id: "UK", spending: { stateGrants: 0 }, baselineStateGrants: 250_000_000 },
    });

    await processRegionalBudgets(db as never, 10);

    expect(written().westminsterGrant).toBeCloseTo(250_000_000, 0);
  });

  it("detects deficit when spending exceeds revenue", async () => {
    wire({
      regions: [{ _id: "LON", countryId: "UK", population: 9_000_000, gdp: 3000 }],
      policies: [
        {
          stateId: "LON",
          scope: "state",
          legislationTypeId: "uk_nhs_funding",
          policyOptionId: "uk_nhs_funding_opt_0",
          policyOptionIndex: 0,
        },
      ],
      legTypes: [
        {
          _id: "uk_nhs_funding",
          // Very expensive option — will create deficit
          policyOptions: [{ id: "uk_nhs_funding_opt_0", annualCostPerCapita: 999_999 }],
        },
      ],
    });

    const result = await processRegionalBudgets(db as never, 10);
    expect(result).toEqual({ regionsProcessed: 1 });

    // Verify budget was upserted with deficit state (now via batched bulkWrite)
    expect(db.collectionMocks["regionalBudgets"]!.bulkWrite).toHaveBeenCalledTimes(1);
    const setData = written();
    expect(setData.isOverBudget).toBe(true);
    expect(setData.surplus).toBeLessThan(0);
    expect(setData.turnsOverBudget).toBe(1);
  });

  it("resets turnsOverBudget to 0 when in surplus", async () => {
    wire({
      regions: [{ _id: "LON", countryId: "UK", population: 1_000_000, gdp: 1000 }],
      // Existing budget was previously over budget
      existingBudgets: [
        {
          _id: "LON",
          turnsOverBudget: 3,
          propertyValuePerCapita: 120_000,
          commercialValuePerCapita: 45_000,
          propertyValueBaseline: 120_000,
          commercialValueBaseline: 45_000,
          chancellorAllocation: null,
        },
      ],
    });

    await processRegionalBudgets(db as never, 10);

    const setData = written();
    // No spending at all, so surplus should be positive
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
