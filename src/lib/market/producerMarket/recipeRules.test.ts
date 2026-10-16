import { describe, expect, it } from "vitest";
import { producerRecipe } from "./recipeRules";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import {
  getEffectiveStrategyRatesForOperatingModel,
  SECTOR_STRATEGIES,
} from "@/lib/constants/sectorStrategies";
import { OPERATING_SECTOR_TYPES } from "@/lib/constants/corporations";
import { unitYieldForSupply } from "@/lib/constants/capacityEconomy";

describe("physical producer recipes", () => {
  it("matches actual capacity units for every sector, including finance, in both qualified eras", () => {
    for (const preset of ["1991-default", "2019-default"]) {
      for (const lane of OPERATING_SECTOR_TYPES) {
        for (const strategy of SECTOR_STRATEGIES[lane]) {
          if (strategy.minDecade != null && Number(strategy.minDecade) > Number(preset.slice(0, 4)))
            continue;
          const rates = getEffectiveStrategyRatesForOperatingModel(
            lane,
            strategy.id,
            undefined,
            undefined,
            0,
            undefined,
            undefined,
            preset
          );
          for (const eraUnitScale of [1, 3.75]) {
            const recipe = producerRecipe({ ...rates, eraUnitScale });
            expect(recipe.unitsPerNominalAnchor).toBe(
              unitYieldForSupply(rates.supply, eraUnitScale)
            );
            expect(recipe.outputs.reduce((sum, row) => sum + row.unitsPerOutput, 0)).toBeCloseTo(
              1,
              12
            );
            for (const row of [...recipe.inputs, ...recipe.outputs]) {
              const rate = (recipe.inputs.includes(row) ? rates.demand : rates.supply)[
                row.commodity
              ]!;
              expect(row.unitsPerOutput * recipe.unitsPerNominalAnchor).toBeCloseTo(
                (rate / COMMODITY_BASE_PRICES[row.commodity]) * eraUnitScale,
                12
              );
            }
          }
        }
      }
    }
  });

  it("rejects unpriced, empty and nonfinite physical recipes", () => {
    expect(() => producerRecipe({ supply: {}, demand: {}, eraUnitScale: 1 })).toThrow(
      "physical output"
    );
    expect(() => producerRecipe({ supply: { food: 1 }, demand: {}, eraUnitScale: 0 })).toThrow(
      "unit scale"
    );
    expect(() => producerRecipe({ supply: { food: NaN }, demand: {}, eraUnitScale: 1 })).toThrow(
      "commodity recipe"
    );
  });
});
