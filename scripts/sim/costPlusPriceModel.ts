import { getStrategy } from "../../src/lib/constants/sectorStrategies";
import { getSectorLaborShare } from "../../src/lib/labour/laborCost";
import { PLANT_OVERHEAD_OUTPUT_SHARE } from "../../src/lib/corporations/plantCosts/rules";
import { costPlusPriceFactor } from "../../src/lib/market/clearing";
import { priceRealizationFactor } from "../../src/lib/market/priceRealization";

const inputShare = Object.values(getStrategy("manufacturing", "standard").demand ?? {}).reduce(
  (sum, rate) => sum + rate,
  0
);
const payroll = getSectorLaborShare("manufacturing", 1991);
for (const ratio of [1, 2.25, 10]) {
  for (const markup of [0, 0.1]) {
    for (const fill of [1, 0.5]) {
      const index = priceRealizationFactor(ratio);
      const offered = costPlusPriceFactor(index, markup, inputShare);
      const cost = inputShare * index + payroll + PLANT_OVERHEAD_OUTPUT_SHARE;
      const revenue = offered * fill;
      console.log(
        JSON.stringify({
          ratio,
          markup,
          fill,
          offered,
          revenue,
          cost,
          profit: revenue - cost,
          margin: Math.round(((revenue - cost) / revenue) * 10_000) / 100,
        })
      );
    }
  }
}
