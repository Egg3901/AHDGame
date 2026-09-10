import { describe, expect, it } from "vitest";
import { getNationalBudgetSeedConfigsForPreset } from "./budgets";

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
    // era onward, newer authored bundles may override but never drop a country.
    for (let index = 3; index < PRESETS.length; index += 1) {
      const prior = new Set(
        getNationalBudgetSeedConfigsForPreset(PRESETS[index - 1]).map((config) => config.countryId)
      );
      const current = new Set(
        getNationalBudgetSeedConfigsForPreset(PRESETS[index]).map((config) => config.countryId)
      );
      expect(
        [...prior].filter((countryId) => !current.has(countryId)),
        PRESETS[index]
      ).toEqual([]);
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
