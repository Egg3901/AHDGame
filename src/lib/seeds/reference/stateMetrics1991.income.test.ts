import { describe, expect, it } from "vitest";
import { applyEra1991Adjustments, stateMetrics1991 } from "./stateMetrics1991";
import { stateMetrics as stateMetrics2020 } from "./stateMetrics";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

describe("1991 seed income — era income-anchor SSOT (no ×0.4 inference)", () => {
  it("scales every state's income by anchor(US,1991)/anchor(US,2019)", () => {
    const ratio = getIncomeAnchor("US", 1991)! / getIncomeAnchor("US", 2019)!;
    const base = stateMetrics2020.find((m) => m.economic?.medianIncome?.value)!;
    const adjusted = applyEra1991Adjustments(base);
    expect(adjusted.economic.medianIncome.value).toBe(
      Math.round(base.economic.medianIncome.value * ratio)
    );
  });

  it("regional variation is preserved (ordering unchanged)", () => {
    const incomes1991 = stateMetrics1991.map((m) => m.economic.medianIncome.value);
    const incomes2020 = stateMetrics2020.map((m) => m.economic.medianIncome.value);
    for (let i = 1; i < incomes1991.length; i++) {
      const sign2020 = Math.sign(incomes2020[i] - incomes2020[i - 1]);
      const sign1991 = Math.sign(incomes1991[i] - incomes1991[i - 1]);
      // Rounding can flatten near-ties, but ordering must never invert.
      expect(sign1991 === sign2020 || sign1991 === 0).toBe(true);
    }
  });
});
