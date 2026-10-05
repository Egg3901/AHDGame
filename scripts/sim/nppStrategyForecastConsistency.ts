/**
 * Controlled #2335 forecast comparisons using the production price and billing kernels.
 * These repeated observations establish formula consistency, not world balance or profit.
 * Run: npx tsx scripts/sim/nppStrategyForecastConsistency.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";
import { computePriceRealization } from "@/lib/market/priceRealization";
import {
  decideExtractionStrategySwitch,
  scoreStrategyExpectedRevenue,
} from "@/lib/turn/npp/strategyExpectedRevenue";
import {
  forecastStrategyContribution,
  type StrategyContributionContext,
} from "@/lib/turn/npp/rules/strategyContribution";

const recipes = SECTOR_STRATEGIES.extraction.filter((recipe) =>
  ["iron_mining", "rare_earth_mining"].includes(recipe.id)
);
const source = "src/lib/turn/npp/rules/strategyContribution.ts";
const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
const observations = Array.from({ length: 48 }, (_, turn) => {
  const context: StrategyContributionContext = {
    mode: "realization",
    priceRatios: { iron: 3, rare_earth: [20, 50, 100][turn % 3] },
    balances: {},
    sellableShares: {},
    headroom: {},
    currentTurn: turn,
  };
  const options = {
    currentStrategyId: "iron_mining",
    strategies: recipes,
    priceRatioOf: (key: string) => (key === "iron" ? 3 : context.priceRatios.rare_earth!),
    headroomOf: () => 1,
  };
  return {
    legacy: decideExtractionStrategySwitch(options)?.strategyId ?? "keep iron_mining",
    forecast:
      decideExtractionStrategySwitch({
        ...options,
        scoreOf: (recipe) =>
          forecastStrategyContribution(
            { supply: recipe.supply, demand: recipe.demand ?? {} },
            context
          ).score,
      })?.strategyId ?? "keep iron_mining",
  };
});

const prices = new Map<CommodityType, number>([
  ["iron", 3],
  ["rare_earth", 20],
]);
const context: StrategyContributionContext = {
  mode: "realization",
  priceRatios: Object.fromEntries(prices),
  balances: {},
  sellableShares: {},
  headroom: {},
  currentTurn: 300,
};

console.log(`# NPP forecast consistency, issue #2335

Reproduce with \`npx tsx scripts/sim/nppStrategyForecastConsistency.ts\`.
Rules source SHA-256: \`${hash}\`.

## Controlled output-price comparison

Two production extraction recipes, full deposit room, no costs or clearing.
The sector-price oracle is the production \`computePriceRealization\` kernel.

| Recipe | Raw price score | New output forecast | Production output-price term |
| --- | ---: | ---: | ---: |`);
for (const recipe of recipes) {
  const raw = scoreStrategyExpectedRevenue(
    recipe.supply,
    (key) => prices.get(key) ?? null,
    () => 1
  );
  const forecast = forecastStrategyContribution(recipe, context);
  const outputRate = Object.values(recipe.supply).reduce((sum, rate) => sum + (rate ?? 0), 0);
  const oracle = outputRate * computePriceRealization(recipe.supply, prices);
  if (Math.abs(forecast.outputValue - oracle) > 1e-12) throw new Error("Output oracle mismatch");
  console.log(
    `| ${recipe.id} | ${raw.toFixed(4)} | ${forecast.outputValue.toFixed(4)} | ${oracle.toFixed(4)} |`
  );
}

console.log(`
48 independent observations alternate rare-earth raw price ratios 20, 50 and 100,
with iron fixed at 3. Every observation starts with iron; no production or market
state evolves between observations. The legacy chooser requests rare-earth retooling
in ${observations.filter((row) => row.legacy === "rare_earth_mining").length}/48 observations;
the new chooser keeps iron in ${observations.filter((row) => row.forecast === "keep iron_mining").length}/48.
Both use the unchanged 25% switch threshold. This is a saturation regression sweep,
not a 48-turn game simulation.

## Plants input-bill oracle

Nominal daily revenue 1, utilization 1, policy multiplier 1 and turns-per-day 1.
Output prices are neutral; all input ratios are neutral. These normalized input
costs are compared directly to production \`computeInputsCost\`.

| Recipe | Forecast input cost | Production bill |
| --- | ---: | ---: |`);
for (const recipe of recipes) {
  const forecast = forecastStrategyContribution(recipe, {
    ...context,
    mode: "plants",
    priceRatios: {},
  });
  const bill = computeInputsCost({
    nominalDailyRevenue: 1,
    rates: recipe.demand,
    basePrices: COMMODITY_BASE_PRICES,
    priceRatios: new Map(),
    utilization: 1,
    inputMultiplier: 1,
    turnsPerDay: 1,
  });
  if (Math.abs(forecast.inputCost - bill.total) > 1e-12) throw new Error("Input oracle mismatch");
  console.log(`| ${recipe.id} | ${forecast.inputCost.toFixed(4)} | ${bill.total.toFixed(4)} |`);
}

console.log(`
## Limits and remaining qualification

The forecast estimates normalized recipe contribution. Deposit room and lagged
aggregate sellability are proxies. It does not reproduce individual clearing
priority, transitional recipes, technology, posture, labor, fixed costs, policy,
landed-price premiums or financing. It establishes neither profit nor survival.

Before closing #2335, run a paired pinned 48-192-turn world simulation and report
chosen strategies, delivered units, actual input bills and cash returns, shortage
duration, and player/NPP competition. Preserve the cooldown and transition guards.
`);
