/**
 * Deterministic household-basket check using the production allocator.
 *
 * The fixture has neutral signals, base prices, no plants cap, and no income
 * or price modifiers. It demonstrates that removing the B2B advertising weight
 * renormalizes the remaining basket without changing the household budget.
 */
import {
  computeHouseholdConsumption,
  HOUSEHOLD_CONSUMER_BASKET,
} from "@/lib/turn/householdConsumption";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

const state = {
  stateId: "US-report",
  countryId: "US",
  gdp: 100_000,
  population: 10_000_000,
};
const perCapitaBudget = 0.002;
const expectedBudget = state.population * perCapitaBudget;
const result = computeHouseholdConsumption({
  states: [state],
  metricsByState: new Map(),
  perCapita: perCapitaBudget,
});
const stateDemand = result.byState.get(state.stateId) ?? new Map<CommodityType, number>();
const advertisingUnits = result.global.get("advertising") ?? 0;
const entertainmentUnits = result.global.get("entertainment_services") ?? 0;
const allocatedBudget = [...stateDemand].reduce(
  (sum, [commodity, units]) => sum + units * (COMMODITY_BASE_PRICES[commodity] ?? 0),
  0
);
const activeWeightTotal = Object.values(HOUSEHOLD_CONSUMER_BASKET).reduce(
  (sum, weight) => sum + (weight ?? 0),
  0
);
const previousWeightTotal = activeWeightTotal + 0.02;

if (advertisingUnits !== 0)
  throw new Error(`Expected zero advertising demand, got ${advertisingUnits}.`);
if (!(entertainmentUnits > 0))
  throw new Error("Expected household demand for entertainment services.");
if (Math.abs(allocatedBudget - expectedBudget) > 1e-8) {
  throw new Error(
    `Household basket spend ${allocatedBudget} did not conserve budget ${expectedBudget}.`
  );
}

const report = [
  "# Household advertising B2B allocation check",
  "",
  "This deterministic report calls the production household allocator with neutral signals, base prices, no plants cap, and a fixed population budget.",
  "",
  `Household budget: ${expectedBudget.toFixed(2)} base-price units per turn.`,
  `Advertising units: ${advertisingUnits.toFixed(6)}.`,
  `Entertainment services units: ${entertainmentUnits.toFixed(6)}.`,
  `Spend across active household basket at base prices: ${allocatedBudget.toFixed(6)}.`,
  `Active basket weight total: ${activeWeightTotal.toFixed(6)} (previous total with advertising's 0.02 weight: ${previousWeightTotal.toFixed(6)}).`,
  "",
  "The removed advertising weight is renormalized across the remaining basket by the production rule. The household budget remains fully allocated, entertainment demand remains present, and advertising demand is zero.",
  "",
].join("\n");

process.stdout.write(report);
