import type { CommodityType } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "../priceRealization";

/** Accepts a stored sector type or an operating lane. */
export function supportsCostPlusPricing(sectorType: string): boolean {
  return ["manufacturing", "manufacturing_vehicles", "chemical_industries", "defense"].includes(
    sectorType
  );
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

export interface CostPlusCostBasis {
  inputCostShare: number;
  fixedCostShare: number;
  turn: number;
}

export function validCostPlusBasis(
  basis: CostPlusCostBasis | undefined
): basis is CostPlusCostBasis {
  return (
    !!basis &&
    Number.isSafeInteger(basis.turn) &&
    basis.turn >= 0 &&
    Number.isFinite(basis.inputCostShare) &&
    basis.inputCostShare >= 0 &&
    Number.isFinite(basis.fixedCostShare) &&
    basis.fixedCostShare >= 0 &&
    Number.isFinite(basis.inputCostShare + basis.fixedCostShare) &&
    basis.inputCostShare + basis.fixedCostShare > 0
  );
}

/** Preserve actual operating cost per nominal output value, excluding taxes and financing. */
export function recordCostPlusBasis(input: {
  inputsCost: number;
  fixedCost: number;
  nominalProducedRevenue: number;
  inputCostIndex: number;
  turn: number;
}): CostPlusCostBasis | undefined {
  if (
    !Number.isFinite(input.nominalProducedRevenue) ||
    input.nominalProducedRevenue <= 0 ||
    !Number.isFinite(input.inputCostIndex) ||
    input.inputCostIndex <= 0
  )
    return undefined;
  const basis = {
    inputCostShare: input.inputsCost / input.inputCostIndex / input.nominalProducedRevenue,
    fixedCostShare: input.fixedCost / input.nominalProducedRevenue,
    turn: input.turn,
  };
  return validCostPlusBasis(basis) ? basis : undefined;
}

/** Recorded operating cost plus markup; output scarcity never multiplies this price. */
export function costPlusPriceFactor(
  index: number,
  markup: number,
  inputShare = 1,
  fixedShare = 0
): number {
  const boundedIndex = Number.isFinite(index) ? Math.max(0.7, Math.min(1.5, index)) : 1;
  const share = Number.isFinite(inputShare) ? Math.max(0, inputShare) : 0;
  const fixed = Number.isFinite(fixedShare) ? Math.max(0, fixedShare) : 0;
  return (fixed + share * boundedIndex) * (1 + clampPricingPosture(markup));
}
