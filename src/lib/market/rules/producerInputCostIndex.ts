/** Producer input pressure uses the same damped price factors as physical input bills. */
import type { CommodityType } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "../priceRealization";

export function producerInputCostIndex(
  recipe: readonly { commodity: CommodityType; rate: number }[],
  ratios: ReadonlyMap<CommodityType, number>
): number {
  let weighted = 0;
  let totalRate = 0;
  for (const { commodity, rate } of recipe) {
    if (!Number.isFinite(rate) || rate <= 0) continue;
    weighted += rate * priceRealizationFactor(ratios.get(commodity));
    totalRate += rate;
  }
  return totalRate > 0 ? weighted / totalRate : 1;
}
