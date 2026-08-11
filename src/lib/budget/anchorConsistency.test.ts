import { describe, it, expect } from "vitest";
import { COST_SCALE_ANCHORS } from "./costs";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import type { CountryId } from "@/lib/constants/countries";

describe("COST_SCALE_ANCHORS stay in sync with the budget seed configs", () => {
  const low = getNationalBudgetSeedConfigsForPreset("1991-default");
  const high = getNationalBudgetSeedConfigsForPreset("2019-default");

  for (const countryId of Object.keys(COST_SCALE_ANCHORS) as CountryId[]) {
    it(`${countryId} low/high gdp & population match the seed configs`, () => {
      const anchor = COST_SCALE_ANCHORS[countryId]!;
      const lowCfg = low.find((c) => c.countryId === countryId);
      const highCfg = high.find((c) => c.countryId === countryId);
      expect(lowCfg, `${countryId} 1991 seed config`).toBeDefined();
      expect(highCfg, `${countryId} 2020/2023 seed config`).toBeDefined();
      expect(anchor.gdpLow).toBe(lowCfg!.gdp);
      expect(anchor.popLow).toBe(lowCfg!.population);
      expect(anchor.gdpHigh).toBe(highCfg!.gdp);
      expect(anchor.popHigh).toBe(highCfg!.population);
    });
  }
});
