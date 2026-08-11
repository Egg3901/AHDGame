import { describe, expect, it } from "vitest";
import {
  generateCountryOwnedSeedData,
  initialNationalBudgets,
  initialUkBudget,
  generateStateBudgets,
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { SECTOR_MARKET_GDP_FRACTION, SECTOR_TYPE_COUNT } from "@/lib/constants/corporations";
import { isFiscalYearEnd, calculateFiscalYear } from "./fiscalYear";

// ─── Test data ─────────────────────────────────────────────────────────────────

const UK_STATES = [
  { id: "LON", population: 9_000_000, gdp: 600_000_000_000, countryId: "UK" },
  { id: "SEE", population: 9_200_000, gdp: 350_000_000_000, countryId: "UK" },
  { id: "NWE", population: 7_400_000, gdp: 250_000_000_000, countryId: "UK" },
  { id: "SCO", population: 5_500_000, gdp: 200_000_000_000, countryId: "UK" },
  { id: "WMI", population: 5_900_000, gdp: 180_000_000_000, countryId: "UK" },
  { id: "YHU", population: 5_500_000, gdp: 170_000_000_000, countryId: "UK" },
  { id: "EMI", population: 4_900_000, gdp: 160_000_000_000, countryId: "UK" },
  { id: "SWE", population: 5_700_000, gdp: 175_000_000_000, countryId: "UK" },
  { id: "EEN", population: 6_300_000, gdp: 200_000_000_000, countryId: "UK" },
  { id: "WAL", population: 3_100_000, gdp: 90_000_000_000, countryId: "UK" },
  { id: "NEE", population: 2_700_000, gdp: 75_000_000_000, countryId: "UK" },
  { id: "NIR", population: 1_900_000, gdp: 50_000_000_000, countryId: "UK" },
];

const US_STATES = [
  { id: "DC", population: 700_000, gdp: 200_000_000_000, countryId: "US" },
  { id: "CA", population: 39_000_000, gdp: 3_900_000_000_000, countryId: "US" },
  { id: "TX", population: 30_000_000, gdp: 2_000_000_000_000, countryId: "US" },
];

const ALL_STATES = [...US_STATES, ...UK_STATES];

// ─── 1. UK healthcare sectors ≤ 80% market share ──────────────────────────────

describe("UK healthcare sector market share", () => {
  const seedData = generateCountryOwnedSeedData(ALL_STATES, "2019-default");
  const ukEntry = seedData.find((d) => d.corporation.countryOwnerId === "UK");

  it("seeds UK country-owned corporation with healthcare sectors", () => {
    expect(ukEntry).toBeDefined();
    expect(ukEntry!.corporation.type).toBe("healthcare");
    expect(ukEntry!.sectors.length).toBeGreaterThan(0);
  });

  it("total NHS revenue ≤ 80% of total UK healthcare market", () => {
    const totalUkGdp = UK_STATES.reduce((sum, s) => sum + s.gdp, 0);
    const totalHealthcareMarket = (totalUkGdp * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT;

    const totalNhsRevenue = ukEntry!.sectors.reduce((sum, s) => sum + s.revenue, 0);

    const marketShare = totalNhsRevenue / totalHealthcareMarket;
    // Floating-point ratio can land just above 0.8 (e.g. 0.80000000000004)
    expect(marketShare).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(marketShare).toBeGreaterThan(0); // sanity: non-zero
  });

  it("each sector is tagged as healthcare", () => {
    for (const sector of ukEntry!.sectors) {
      expect(sector.sectorType).toBe("healthcare");
    }
  });

  it("distributes sectors proportionally to regional GDP", () => {
    const totalUkGdp = UK_STATES.reduce((sum, s) => sum + s.gdp, 0);
    const totalNhsRevenue = ukEntry!.sectors.reduce((sum, s) => sum + s.revenue, 0);

    for (const sector of ukEntry!.sectors) {
      const state = UK_STATES.find((s) => s.id === sector.stateId);
      expect(state).toBeDefined();

      const expectedShare = state!.gdp / totalUkGdp;
      const actualShare = sector.revenue / totalNhsRevenue;
      // Allow 1% tolerance for rounding
      expect(actualShare).toBeCloseTo(expectedShare, 1);
    }
  });
});

// ─── 2. UK and US natcorps visible on stock exchange ──────────────────────────

describe("NatCorp stock exchange visibility", () => {
  const seedData = generateCountryOwnedSeedData(ALL_STATES, "2019-default");
  const ukCorp = seedData.find((d) => d.corporation.countryOwnerId === "UK")!.corporation;
  const usCorp = seedData.find((d) => d.corporation.countryOwnerId === "US")!.corporation;

  it("UK natcorp is not hidden from exchange", () => {
    expect(ukCorp.hiddenFromExchange).toBe(false);
  });

  it("US natcorp is not hidden from exchange", () => {
    expect(usCorp.hiddenFromExchange).toBe(false);
  });

  it("UK natcorp HQ is in a UK state (FTSE eligible)", () => {
    // Post-migration: UK state IDs are unprefixed (e.g. "LON", not "UK_LON")
    // Verify it's a known UK region ID from our test data
    const ukStateIds = UK_STATES.map((s) => s.id);
    expect(ukStateIds).toContain(ukCorp.headquartersState);
  });

  it("US natcorp HQ is in a US state (NYSE eligible)", () => {
    const usStateIds = US_STATES.map((s) => s.id);
    expect(usStateIds).toContain(usCorp.headquartersState);
  });
});

// ─── 3. NatCorp detail page data ──────────────────────────────────────────────

describe("NatCorp detail page resolvability", () => {
  const seedData = generateCountryOwnedSeedData(ALL_STATES, "2019-default");

  it("UK natcorp has a valid ObjectId _id for corp detail page", () => {
    const ukCorp = seedData.find((d) => d.corporation.countryOwnerId === "UK")!.corporation;
    // ObjectId is a 24-character hex string
    expect(ukCorp._id.toString()).toMatch(/^[0-9a-f]{24}$/);
  });

  it("US natcorp has a valid ObjectId _id for corp detail page", () => {
    const usCorp = seedData.find((d) => d.corporation.countryOwnerId === "US")!.corporation;
    expect(usCorp._id.toString()).toMatch(/^[0-9a-f]{24}$/);
  });

  it("natcorps have required fields for corp detail page rendering", () => {
    for (const entry of seedData) {
      const corp = entry.corporation;
      expect(corp.name).toBeTruthy();
      expect(corp.type).toBeTruthy();
      expect(corp.headquartersState).toBeTruthy();
      expect(corp.ceoId.toString()).toMatch(/^[0-9a-f]{24}$/);
      expect(corp.userId.toString()).toMatch(/^[0-9a-f]{24}$/);
      expect(typeof corp.sharePrice).toBe("number");
      expect(typeof corp.totalShares).toBe("number");
    }
  });

  it("UK natcorp sectors each reference the parent corporation id", () => {
    const ukEntry = seedData.find((d) => d.corporation.countryOwnerId === "UK")!;
    for (const sector of ukEntry.sectors) {
      expect(sector.corporationId.toString()).toBe(ukEntry.corporation._id.toString());
    }
  });
});

// ─── 4. Budget spending categories populated after fiscal year rollover ───────

describe("Budget spending categories after fiscal year rollover", () => {
  it("US federal budget has populated spending categories from seed", () => {
    const usBudget = initialNationalBudgets.find((b) => b.countryId === "US")!;

    expect(Object.keys(usBudget.spending.byCategory).length).toBeGreaterThanOrEqual(5);
    expect(usBudget.spending.byCategory.healthcare).toBeGreaterThan(0);
    expect(usBudget.spending.byCategory.defense).toBeGreaterThan(0);
    expect(usBudget.spending.byCategory.socialSecurity).toBeGreaterThan(0);
    expect(usBudget.spending.byCategory.education).toBeGreaterThan(0);
    expect(usBudget.spending.byCategory.infrastructure).toBeGreaterThan(0);
    expect(usBudget.spending.byCategory.other).toBeGreaterThan(0);

    // Total spending should be sum of categories + state grants + debt interest
    const categoryTotal = Object.values(usBudget.spending.byCategory).reduce((a, b) => a + b, 0);
    expect(usBudget.spending.total).toBe(
      categoryTotal + usBudget.spending.stateGrants + usBudget.spending.debtInterest
    );
  });

  it("UK federal budget has populated spending categories from seed", () => {
    expect(Object.keys(initialUkBudget.spending.byCategory).length).toBeGreaterThanOrEqual(5);
    expect(initialUkBudget.spending.byCategory.healthcare).toBeGreaterThan(0);
    expect(initialUkBudget.spending.byCategory.education).toBeGreaterThan(0);
    expect(initialUkBudget.spending.byCategory.social).toBeGreaterThan(0);
    expect(initialUkBudget.spending.byCategory.defense).toBeGreaterThan(0);
    expect(initialUkBudget.spending.byCategory.infrastructure).toBeGreaterThan(0);
    expect(initialUkBudget.spending.byCategory.economic).toBeGreaterThan(0);

    const categoryTotal = Object.values(initialUkBudget.spending.byCategory).reduce(
      (a, b) => a + b,
      0
    );
    expect(initialUkBudget.spending.total).toBe(
      categoryTotal + initialUkBudget.spending.stateGrants + initialUkBudget.spending.debtInterest
    );
  });

  it("state budgets have spending categories populated", () => {
    const stateBudgets = generateStateBudgets(ALL_STATES);

    for (const budget of stateBudgets) {
      const categories = Object.keys(budget.spending.byCategory);
      expect(categories.length).toBeGreaterThanOrEqual(4);
      expect(budget.spending.byCategory.education).toBeGreaterThan(0);
      expect(budget.spending.byCategory.healthcare).toBeGreaterThan(0);
      expect(budget.spending.byCategory.transportation).toBeGreaterThan(0);
      expect(budget.spending.byCategory.publicSafety).toBeGreaterThan(0);
      expect(budget.spending.total).toBeGreaterThan(0);
    }
  });

  it("enacted laws seed produces laws with budget categories for both countries", () => {
    const laws = generateDefaultEnactedLaws("2019-default");

    const usLaws = laws.filter((l) => l.countryId === "US");
    const ukLaws = laws.filter((l) => l.countryId === "UK");

    expect(usLaws.length).toBeGreaterThan(0);
    expect(ukLaws.length).toBeGreaterThan(0);

    // Every law has a budget category
    for (const law of laws) {
      expect(law.budgetCategory).toBeTruthy();
    }

    // US and UK should have distinct category sets
    const usCategories = new Set(usLaws.map((l) => l.budgetCategory));
    const ukCategories = new Set(ukLaws.map((l) => l.budgetCategory));
    expect(usCategories.size).toBeGreaterThanOrEqual(2);
    expect(ukCategories.size).toBeGreaterThanOrEqual(2);
  });

  it("1991 US and UK national budgets start with plausible fiscal gaps", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    const usBudget = budgets.find((budget) => budget.countryId === "US");
    const ukBudget = budgets.find((budget) => budget.countryId === "UK");

    expect(usBudget).toBeDefined();
    expect(ukBudget).toBeDefined();

    const usSurplusToGdp = usBudget!.surplus / usBudget!.gdp;
    const ukSurplusToGdp = ukBudget!.surplus / ukBudget!.gdp;

    expect(usSurplusToGdp).toBeGreaterThan(-0.08);
    expect(ukSurplusToGdp).toBeGreaterThan(-0.05);
  });

  it("1991 CN national budget retains seeded program spending beyond debt service", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    const cnBudget = budgets.find((budget) => budget.countryId === "CN");

    expect(cnBudget).toBeDefined();
    expect(cnBudget!.spending.byCategory.health).toBeGreaterThan(0);
    expect(cnBudget!.spending.byCategory.education).toBeGreaterThan(0);
    expect(cnBudget!.spending.byCategory.defense).toBeGreaterThan(0);
    // CN now seeds itemized program-spending laws (no isGrant type, same as
    // US/DE), so categorised program spending — not state grants — carries the
    // budget beyond debt service.
    const cnCategoryTotal = Object.values(cnBudget!.spending.byCategory).reduce(
      (sum, amount) => sum + amount,
      0
    );
    expect(cnCategoryTotal).toBeGreaterThan(cnBudget!.spending.debtInterest);
    expect(cnBudget!.spending.total).toBeGreaterThan(cnBudget!.spending.debtInterest);
  });

  it("fiscal year end is detected at turn 40", () => {
    expect(isFiscalYearEnd(40)).toBe(true);
    expect(isFiscalYearEnd(88)).toBe(true); // 40 + 48
    expect(isFiscalYearEnd(39)).toBe(false);
    expect(isFiscalYearEnd(41)).toBe(false);
  });

  it("fiscal year advances correctly after October", () => {
    // Turn 40 is October → FY = currentYear + 1
    expect(calculateFiscalYear(2024, 40)).toBe(2025);
    // Turn 39 is September → FY = currentYear
    expect(calculateFiscalYear(2024, 39)).toBe(2024);
  });
});
