import type { CommodityType } from "@/lib/constants/commodities";
import {
  PRICE_REALIZATION_MAX,
  PRICE_REALIZATION_MIN,
  priceRealizationFactor,
} from "../priceRealization";

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

export const COST_PLUS_UTILISATION_FLOOR = 0.5;

/** Spread fixed costs over at least half capacity so throttling cannot inflate the quote. */
export function costPlusFixedDenominatorRevenue(
  nameplateRevenuePerTurn: number,
  producedUnits: number,
  plantsCapacity: number
): number {
  return plantsCapacity > 0
    ? (nameplateRevenuePerTurn *
        Math.max(producedUnits, COST_PLUS_UTILISATION_FLOOR * plantsCapacity)) /
        plantsCapacity
    : 0;
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

/** Record input costs per actual output and fixed costs per the supplied allocation basis. */
export function recordCostPlusBasis(input: {
  inputsCost: number;
  fixedCost: number;
  nominalProducedRevenue: number;
  fixedDenominatorRevenue?: number;
  inputCostIndex: number;
  turn: number;
}): CostPlusCostBasis | undefined {
  const fixedDenominatorRevenue = input.fixedDenominatorRevenue ?? input.nominalProducedRevenue;
  if (
    !Number.isFinite(input.nominalProducedRevenue) ||
    input.nominalProducedRevenue <= 0 ||
    !Number.isFinite(fixedDenominatorRevenue) ||
    fixedDenominatorRevenue <= 0 ||
    !Number.isFinite(input.inputCostIndex) ||
    input.inputCostIndex <= 0
  )
    return undefined;
  const basis = {
    inputCostShare: input.inputsCost / input.inputCostIndex / input.nominalProducedRevenue,
    fixedCostShare: input.fixedCost / fixedDenominatorRevenue,
    turn: input.turn,
  };
  return validCostPlusBasis(basis) ? basis : undefined;
}

/**
 * Recorded operating cost plus markup; output scarcity never multiplies this price.
 *
 * The index is bounded by the same realization clamp the input bill uses
 * (`priceRealizationFactor`), so the quote passes material inflation through
 * exactly as far as the bill charges it. A tighter cap here (it was 1.5 while
 * the bill ran to 2.0) quoted below cost whenever inputs averaged above 2.25x
 * base, so a sold-out plant lost money at any markup.
 */
export function costPlusPriceFactor(
  index: number,
  markup: number,
  inputShare = 1,
  fixedShare = 0
): number {
  const boundedIndex = Number.isFinite(index)
    ? Math.max(PRICE_REALIZATION_MIN, Math.min(PRICE_REALIZATION_MAX, index))
    : 1;
  const share = Number.isFinite(inputShare) ? Math.max(0, inputShare) : 0;
  const fixed = Number.isFinite(fixedShare) ? Math.max(0, fixedShare) : 0;
  return (fixed + share * boundedIndex) * (1 + clampPricingPosture(markup));
}
