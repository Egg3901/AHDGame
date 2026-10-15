/** Frozen-price sensitivity of the twelve-turn hardware process improvement. */
import { strict as assert } from "node:assert";
import { getEffectiveStrategyRates } from "../../src/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import { computeInputsCost } from "../../src/lib/corporations/physicalPnl";
import { computePriceRealization } from "../../src/lib/market/priceRealization";

const rows = [];
let assertions = 0;
for (const preset of ["1953-default", "1991-default", "2027-default"])
  for (const strategy of ["hardware", "standard", "software"])
    for (const [inputRatio, outputRatio] of [
      [1, 1],
      [2.25, 2.33],
      [4, 1],
      [1, 0.49],
    ])
      for (const utilization of [0, 0.6, 1])
        for (const scale of [1, 100]) {
          const nominalDailyRevenue = 24000 * scale;
          const bill = (elapsed: number, enabled: boolean) => {
            const rates = getEffectiveStrategyRates(
              "technology",
              strategy,
              null,
              null,
              100 + elapsed,
              undefined,
              preset,
              enabled ? 100 : undefined
            );
            const prices = new Map(
              (Object.keys(rates.demand) as CommodityType[]).map((c) => [c, inputRatio!])
            );
            const outputs = new Map(
              (Object.keys(rates.supply) as CommodityType[]).map((c) => [c, outputRatio!])
            );
            const costs = computeInputsCost({
              nominalDailyRevenue,
              rates: rates.demand,
              basePrices: COMMODITY_BASE_PRICES,
              priceRatios: prices,
              utilization,
              inputMultiplier: 1,
              turnsPerDay: 24,
            });
            return {
              cost: costs.total,
              revenue:
                (nominalDailyRevenue / 24) *
                utilization *
                computePriceRealization(rates.supply, outputs),
            };
          };
          const baseline = bill(0, false);
          const points = [0, 1, 6, 12, 24].map((elapsed) => {
            const result = bill(elapsed, true);
            const expectedMultiplier =
              strategy === "hardware" ? 1 - 0.15 * Math.min(1, elapsed / 12) : 1;
            assert(Math.abs(result.cost - baseline.cost * expectedMultiplier) < 1e-7);
            assert.equal(result.revenue, baseline.revenue);
            assertions += 2;
            return { elapsed, ...result };
          });
          rows.push({
            preset,
            strategy,
            inputRatio,
            outputRatio,
            utilization,
            scale,
            baseline,
            points,
          });
        }
console.log(
  JSON.stringify(
    {
      scenarios: rows.length,
      assertions,
      passed: true,
      limitation:
        "Frozen-price cost sensitivity, not an endogenous world trajectory or a forecast of price responses.",
      rows,
    },
    null,
    2
  )
);
