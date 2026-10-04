import type { CommodityType } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "../priceRealization";

export function supportsCostPlusPricing(sectorType: string): boolean {
  return ["manufacturing", "automobiles", "chemical_industries", "defense"].includes(sectorType);
}

/** Same damped input prices used in physical P&L, weighted by recipe spend. */
export function inputBasketCostIndex(
  rates: Partial<Record<CommodityType, number>>,
  ratios: ReadonlyMap<CommodityType, number>
): number {
  let weight = 0;
  let priced = 0;
  for (const commodity of Object.keys(rates) as CommodityType[]) {
    const rate = rates[commodity] ?? 0;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    weight += rate;
    priced += rate * priceRealizationFactor(ratios.get(commodity));
  }
  return weight > 0 ? priced / weight : 1;
}

export const PRICING_POSTURE_MIN = -0.2;
export const PRICING_POSTURE_MAX = 0.2;

export function clampPricingPosture(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(PRICING_POSTURE_MIN, Math.min(PRICING_POSTURE_MAX, value));
}

/** An indexed nominal offer; output scarcity never multiplies this price. */
export function costPlusPriceFactor(index: number, markup: number, inputShare = 1): number {
  const boundedIndex = Number.isFinite(index) ? Math.max(0.7, Math.min(1.5, index)) : 1;
  const share = Number.isFinite(inputShare) ? Math.max(0, Math.min(1, inputShare)) : 0;
  return (1 + share * (boundedIndex - 1)) * (1 + clampPricingPosture(markup));
}
