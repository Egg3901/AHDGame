import { isOrderFlowPriceEligible } from "./marketExecution";

/** Maximum absolute deviation from 1.0 for the order-flow multiplier. */
export const ORDER_FLOW_CAP = 0.15;

/** Fraction of prior multiplier deviation retained each 15-minute interval. */
export const ORDER_FLOW_MEAN_REVERSION = 0.8;

/**
 * Computes the new order-flow multiplier for a corporation.
 *
 * Formula:
 *   carry           = (prevMultiplier - 1) × ORDER_FLOW_MEAN_REVERSION
 *   netPressure     = (windowBuyValue - windowSellValue) / (publicFloat × sharePrice)
 *   liquidityFactor = 1 / (1 + sqrt(publicFloat / totalShares))
 *   result          = 1 + clamp(carry + netPressure × liquidityFactor, −CAP, +CAP)
 *
 * All value inputs must be in the same currency (corp's local currency).
 * Guards: returns `1 + clamp(carry, ...)` when floatValue or totalShares ≤ 0.
 */
export function computeOrderFlowMultiplier(
  windowBuyValue: number,
  windowSellValue: number,
  publicFloat: number,
  sharePrice: number,
  totalShares: number,
  prevMultiplier: number
): number {
  if (!isOrderFlowPriceEligible(publicFloat, totalShares)) {
    return 1.0;
  }

  const carry = (prevMultiplier - 1) * ORDER_FLOW_MEAN_REVERSION;

  const floatValue = publicFloat * sharePrice;
  if (floatValue <= 0 || totalShares <= 0) {
    return 1 + Math.max(-ORDER_FLOW_CAP, Math.min(ORDER_FLOW_CAP, carry));
  }

  const netPressure = (windowBuyValue - windowSellValue) / floatValue;
  const liquidityFactor = 1 / (1 + Math.sqrt(publicFloat / totalShares));
  const pressureContrib = netPressure * liquidityFactor;

  const clamped = Math.max(-ORDER_FLOW_CAP, Math.min(ORDER_FLOW_CAP, carry + pressureContrib));
  return 1 + clamped;
}
