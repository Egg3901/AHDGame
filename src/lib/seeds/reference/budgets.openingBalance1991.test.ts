import { describe, expect, it } from "vitest";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
} from "./budgets";

describe("1991 player fiscal openings", () => {
  it.each([
    ["US", 3_665_000_000_000, 939_213_600_000],
    ["UK", 194_118_000_000, 229_306_050_000],
    ["JP", 172_000_000_000_000, 123_714_000_000_000],
  ] as const)(
    "%s preserves historic debt and receipts with a small coupon-inclusive deficit",
    (countryId, principal, revenue) => {
      const config = getNationalBudgetSeedConfigsForPreset("1991-default").find(
        (row) => row.countryId === countryId
      )!;
      const budget = getInitialNationalBudgetsForPreset("1991-default").find(
        (row) => row.countryId === countryId
      )!;
      expect(budget.debt.principal).toBe(principal);
      expect(budget.treasuryBalance).toBe(-principal);
      expect(budget.debtToGdpRatio).toBe(principal / budget.gdp);
      expect(budget.sovereignRiskAnchor?.debtToGdpRatio).toBe(principal / budget.gdp);
      expect(budget.revenue.total).toBe(revenue);
      expect(budget.spending.debtInterest).toBe(Math.round(principal * budget.debt.interestRate));
      expect(budget.surplus / budget.gdp).toBeGreaterThanOrEqual(-0.005);

      const laws = generateDefaultEnactedLaws("1991-default").filter(
        (law) => law.countryId === countryId && law.rate === undefined
      );
      expect(laws.length).toBeGreaterThan(0);
      const byCategory: Record<string, number> = {};
      let grants = 0;
      for (const law of laws) {
        expect(law.gdpPerCapitaMultiplier).toBeDefined();
        expect(law.annualCostPerCapita).toBeUndefined();
        expect(law.gdpCostFraction).toBeUndefined();
        expect(law.incomeCostFraction).toBeUndefined();
        const amount = calculateEnactedLawAnnualCost(law, {
          budgetCapacity: budget.revenue.total,
          gdp: budget.gdp,
          population: config.population,
          countryId,
          nationalGdpPerCapita: config.gdp / config.population,
          nationalMedianIncome: 1,
          year: 1991,
        });
        if (law.isGrant) grants += amount;
        else {
          const category = law.budgetCategory ?? "other";
          byCategory[category] = (byCategory[category] ?? 0) + amount;
        }
      }
      for (const [category, expected] of Object.entries(budget.spending.byCategory)) {
        expect(byCategory[category]).toBeCloseTo(expected, 0);
      }
      expect(grants).toBeCloseTo(budget.spending.stateGrants, 0);
      const runtimeSpending =
        Object.values(byCategory).reduce((sum, value) => sum + value, 0) +
        grants +
        budget.spending.debtInterest;
      expect(runtimeSpending).toBeCloseTo(budget.spending.total, 0);
      expect((revenue - runtimeSpending) / budget.gdp).toBeGreaterThanOrEqual(-0.0075);
    }
  );

  it("BR fills the opening envelope with the authored 1991 category mix (issue 3372)", () => {
    const authored = {
      healthcare: 25,
      education: 30,
      socialSecurity: 90,
      defense: 10,
      infrastructure: 15,
      other: 60,
    };
    const authoredGrants = 70;
    const authoredTotal = 300;
    const config = getNationalBudgetSeedConfigsForPreset("1991-default").find(
      (row) => row.countryId === "BR"
    )!;
    const budget = getInitialNationalBudgetsForPreset("1991-default").find(
      (row) => row.countryId === "BR"
    )!;
    expect(config.calibratedSpendingBaseline).toBe(true);
    expect(budget.spending.byCategory.health).toBeUndefined();
    expect(budget.surplus / budget.gdp).toBeCloseTo(-0.005, 4);
    const programs = budget.spending.total - budget.spending.debtInterest;
    // The 1953 ladder booked 3.2% of GDP; the envelope lands well above it.
    expect(programs / budget.gdp).toBeGreaterThan(0.1);
    for (const [category, weight] of Object.entries(authored)) {
      expect(budget.spending.byCategory[category]! / programs).toBeCloseTo(
        weight / authoredTotal,
        6
      );
    }
    expect(budget.spending.stateGrants / programs).toBeCloseTo(authoredGrants / authoredTotal, 6);

    const laws = generateDefaultEnactedLaws("1991-default").filter(
      (law) => law.countryId === "BR" && law.rate === undefined
    );
    // Repricing at the opening GDP and at a later one keeps the same book.
    for (const gdpGrowth of [1, 1.25]) {
      const gdp = budget.gdp * gdpGrowth;
      const byCategory: Record<string, number> = {};
      let grants = 0;
      for (const law of laws) {
        expect(law.gdpPerCapitaMultiplier).toBeDefined();
        const amount = calculateEnactedLawAnnualCost(law, {
          budgetCapacity: budget.revenue.total,
          gdp,
          population: config.population,
          countryId: "BR",
          nationalGdpPerCapita: gdp / config.population,
          nationalMedianIncome: 1,
          year: 1991,
        });
        if (law.isGrant) grants += amount;
        else {
          const category = law.budgetCategory ?? "other";
          byCategory[category] = (byCategory[category] ?? 0) + amount;
        }
      }
      expect(Object.keys(byCategory).sort()).toEqual(Object.keys(authored).sort());
      for (const [category, expected] of Object.entries(budget.spending.byCategory)) {
        expect(byCategory[category]).toBeCloseTo(expected * gdpGrowth, -1);
      }
      expect(grants).toBeCloseTo(budget.spending.stateGrants * gdpGrowth, -1);
    }
  });

  it("leaves later presets and non-player spending at their existing calibration", () => {
    expect(
      getNationalBudgetSeedConfigsForPreset("1999-default").every(
        (config) => !config.calibratedSpendingBaseline
      )
    ).toBe(true);
    const transition = getInitialNationalBudgetsForPreset("1991-default").find(
      (row) => row.countryId === "PL"
    )!;
    expect(transition.revenue.total).toBe(289_168_478_000_000);
    expect(transition.spending.total).toBe(293_474_478_000_000);
  });
});
