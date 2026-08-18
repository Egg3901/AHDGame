import { describe, expect, it } from "vitest";
import {
  initialNationalBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";

describe("national budget seeds carry a signed treasuryBalance", () => {
  it("sets treasuryBalance = -debt.principal on every default seed entry", () => {
    expect(initialNationalBudgets.length).toBeGreaterThan(0);
    for (const budget of initialNationalBudgets) {
      expect(budget.treasuryBalance).toBe(-(budget.debt.principal ?? 0));
    }
  });

  it("sets treasuryBalance on every 1991-preset seed entry", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    expect(budgets.length).toBeGreaterThan(0);
    for (const budget of budgets) {
      expect(budget.treasuryBalance).toBe(-(budget.debt.principal ?? 0));
    }
  });
});

describe("national budget household price index", () => {
  it("seeds every preset at the neutral household price level", () => {
    for (const preset of [
      "1953-default",
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
    ]) {
      for (const budget of getInitialNationalBudgetsForPreset(preset)) {
        expect(budget.economicFactors.householdPriceIndex).toBe(1);
      }
    }
  });
});

describe("national budget seeds have collision-free document IDs (sandbox-seed-audit-t101)", () => {
  // Regression test for a bug found via a live-DB audit: every non-US budget
  // config across the 1953 and 1979 presets (RU/FR/IT/ES/SE/TR/DD/HU/UK/DE/
  // JP/CN/BR, plus PL/RO/YU/BG/BY/CS/BAL via the Eastern-bloc factory) had
  // budgetId hardcoded to the literal "federal" instead of its own country
  // code. Since `_id: config.budgetId` and every country-specific seeder
  // upserts by that `_id`, all of them collided on one shared document —
  // whichever country seeded last silently overwrote every other country's
  // "federal budget" with its own economic figures. In one sandbox this left
  // BAL's tiny economy sitting under what US's central bank turn processing
  // reads and writes every turn as if it were the US federal budget.
  const presets = [
    "2019-default" as const,
    "1991-default" as const,
    "2023-default" as const,
    "2007-default" as const,
    "1999-default" as const,
    "1979-default" as const,
    "1953-default" as const,
  ];

  it.each(presets)("every budget _id is unique within the %s preset", (preset) => {
    const budgets = getInitialNationalBudgetsForPreset(preset);
    expect(budgets.length).toBeGreaterThan(0);
    const ids = budgets.map((b) => b._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(presets)("every non-US budget's _id matches its own countryId in %s", (preset) => {
    const budgets = getInitialNationalBudgetsForPreset(preset);
    for (const budget of budgets) {
      if (budget.countryId === "US") {
        expect(budget._id).toBe("federal");
      } else {
        expect(budget._id).toBe(budget.countryId);
      }
    }
  });
});
