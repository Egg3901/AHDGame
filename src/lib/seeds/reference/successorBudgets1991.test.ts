import { describe, expect, it } from "vitest";
import {
  getInitialNationalBudgetsForPreset,
  getNationalBudgetSeedConfigsForPreset,
  getNationalBudgetSeedProvenance,
} from "./budgets";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT } from "./successorFiscal1991";
import { PL_1991_BUDGET_LAW_MILLION_PLZ } from "@/lib/countries/pl/data/plFiscal1991";

const IDS = ["RU", "PL", "CS", "HU", "RO", "BG", "YU"] as const;

describe("1991 transition national budgets", () => {
  it("starts all seven countries at the authored 1991 fiscal totals and tax rates", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    for (const id of IDS) {
      const budget = budgets.find((entry) => entry.countryId === id);
      expect(budget, id).toBeDefined();
      expect(budget!.gdp, id).toBe(SUCCESSOR_NOMINAL_GDP_1991[id]);
      expect(budget!.taxRates.incomeTax, id).toBeGreaterThan(0);
      const fiscal = SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT[id];
      const expectedRevenue =
        id === "PL"
          ? PL_1991_BUDGET_LAW_MILLION_PLZ.revenue * 1_000_000
          : Math.round((budget!.gdp * fiscal.revenue) / 100);
      const expectedSpending =
        id === "PL"
          ? PL_1991_BUDGET_LAW_MILLION_PLZ.expenditure * 1_000_000
          : Math.round((budget!.gdp * fiscal.expenditure) / 100);
      expect(Math.abs(budget!.revenue.total - expectedRevenue) / expectedRevenue, id).toBeLessThan(
        1e-6
      );
      expect(
        Math.abs(budget!.spending.total - expectedSpending) / expectedSpending,
        id
      ).toBeLessThan(1e-6);
    }
    const provenance = getNationalBudgetSeedProvenance("1991-default");
    expect(
      provenance.filter(
        (row) => IDS.includes(row.countryId as (typeof IDS)[number]) && row.inherited
      )
    ).toEqual([]);
  });

  it("does not carry transition-only budgets into later world presets", () => {
    for (const preset of ["1999-default", "2007-default", "2019-default"]) {
      const later = getNationalBudgetSeedConfigsForPreset(preset);
      expect(later.filter((row) => IDS.includes(row.countryId as (typeof IDS)[number]))).toEqual(
        []
      );
    }
    const modern = getNationalBudgetSeedConfigsForPreset("2027-default");
    expect(
      modern
        .filter((row) => IDS.includes(row.countryId as (typeof IDS)[number]))
        .map((row) => row.countryId)
    ).toEqual(["HU"]);
  });
});
