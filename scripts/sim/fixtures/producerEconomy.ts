/** Deterministic rules qualification. Never connects to a database. */
import assert from "node:assert/strict";
import { OPERATING_SECTOR_TYPES } from "../../../src/lib/constants/corporations";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../../src/lib/constants/commodities";
import {
  getEffectiveStrategyRatesForOperatingModel,
  SECTOR_STRATEGIES,
} from "../../../src/lib/constants/sectorStrategies";
import { isStorable } from "../../../src/lib/market/inventory";
import { type ProductionPlan } from "../../../src/lib/market/producerMarket/production";
import { producerRecipe } from "../../../src/lib/market/producerMarket/recipeRules";
import { isStateScopedCommodity } from "../../../src/lib/market/rules/commodityMarketScope";

export const producerFixtureBook = (commodity: string) =>
  isStateScopedCommodity(commodity as CommodityType) ? "state:fixture" : "world";

export function makeProducerRecipeFixture(preset: string): ProductionPlan[] {
  return OPERATING_SECTOR_TYPES.flatMap((lane) =>
    SECTOR_STRATEGIES[lane]
      .filter(
        (strategy) =>
          strategy.minDecade == null || Number(strategy.minDecade) <= Number(preset.slice(0, 4))
      )
      .map((strategy) => {
        const recipe = getEffectiveStrategyRatesForOperatingModel(
          lane,
          strategy.id,
          undefined,
          undefined,
          0,
          undefined,
          undefined,
          preset
        );
        const physical = producerRecipe({ ...recipe, eraUnitScale: 1 });
        const yieldPerNominal = physical.unitsPerNominalAnchor;
        assert(yieldPerNominal > 0, `Missing output recipe: ${lane}`);
        const nominalValue = 10000;
        return {
          id: `${lane}:${strategy.id}`,
          accountId: `${lane}:${strategy.id}`,
          capacityUnits: nominalValue * yieldPerNominal,
          activeFraction: 1,
          outputMultiplier: 1,
          inputs: physical.inputs.map(({ commodity, unitsPerOutput }) => ({
            commodity,
            book: producerFixtureBook(commodity),
            unitsPerOutput,
            maximumUnitPrice: COMMODITY_BASE_PRICES[commodity as CommodityType] * 1.25,
          })),
          outputs: physical.outputs.map(({ commodity, unitsPerOutput }) => ({
            commodity,
            book: producerFixtureBook(commodity),
            unitsPerOutput,
            policy: { kind: "automatic" as const, targetMarkup: 0.1 },
            referenceUnitPrice: COMMODITY_BASE_PRICES[commodity as CommodityType],
            storable: isStorable(commodity as CommodityType),
          })),
          // Explicit synthetic payroll and maintenance, never fitted to an old margin.
          labourCost: nominalValue * 0.15,
          otherOperatingCost: nominalValue * 0.03,
          labourRecipientAccountId: "households",
          operatingRecipientAccountId: "operating-payee",
          inputStock: [],
          outputStock: [],
        };
      })
  );
}
