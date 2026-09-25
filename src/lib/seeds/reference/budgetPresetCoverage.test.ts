import { describe, expect, it } from "vitest";
import { getNationalBudgetSeedConfigsForPreset } from "./budgets";
import { TRANSITION_1991_BUDGET_COUNTRIES } from "./rules/budgetBaselineMode";

const PRESETS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
];

describe("national budget preset coverage", () => {
  it("does not lose countries between adjacent modern presets", () => {
    // 1991 intentionally retires Soviet-era sovereign entities. From that
    // era onward, newer authored bundles may override but never drop a country,
    // with one scoped exception: the seven 1991 transition-economy baselines
    // are authored for the 1991 world only and retire at 1999 until a later
    // authored row reintroduces each country.
    for (let index = 3; index < PRESETS.length; index += 1) {
      const prior = new Set(
        getNationalBudgetSeedConfigsForPreset(PRESETS[index - 1]).map((config) => config.countryId)
      );
      const current = new Set(
        getNationalBudgetSeedConfigsForPreset(PRESETS[index]).map((config) => config.countryId)
      );
      const dropped = [...prior].filter((countryId) => !current.has(countryId));
      const excused =
        PRESETS[index] === "1999-default"
          ? dropped.filter((countryId) => TRANSITION_1991_BUDGET_COUNTRIES.includes(countryId))
          : [];
      expect(
        dropped.filter((countryId) => !excused.includes(countryId)),
        PRESETS[index]
      ).toEqual([]);
      // Excused as a subset of the transition list (not exact): a later
      // authored row may legitimately reintroduce a country at 1999+,
      // shrinking the retired set without touching this test.
    }
  });

  it("keeps explicitly authored preset overrides", () => {
    const config1999 = getNationalBudgetSeedConfigsForPreset("1999-default");
    const authored1999 = config1999.find((config) => config.countryId === "US");
    expect(authored1999?.fiscalYear).toBe(1999);

    const config2023 = getNationalBudgetSeedConfigsForPreset("2023-default");
    const authored2023 = config2023.find((config) => config.countryId === "US");
    expect(authored2023?.fiscalYear).toBe(2023);
  });
});
