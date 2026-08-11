import type { Corporation } from "@/lib/db/types";

export const MIN_ORDER_FLOW_FLOAT_FRACTION = 0.05;

export type MarketPricedCorporation = Pick<
  Corporation,
  "fundamentalSharePrice" | "publicFloat" | "sharePrice" | "totalShares"
>;

export function isOrderFlowPriceEligible(
  publicFloat: number | null | undefined,
  totalShares: number | null | undefined
): boolean {
  if (!Number.isFinite(totalShares) || (totalShares ?? 0) <= 0) {
    return true;
  }

  return (publicFloat ?? 0) / (totalShares ?? 1) >= MIN_ORDER_FLOW_FLOAT_FRACTION;
}

export function resolveShareExecutionPrice(corporation: MarketPricedCorporation): number {
  const eligible = isOrderFlowPriceEligible(corporation.publicFloat, corporation.totalShares);
  const fundamentalPrice = corporation.fundamentalSharePrice ?? 0;

  // Tiny-float corps let a single holder saturate the order-flow clamp and
  // round-trip against their own quote. Fall back to the turn-priced baseline
  // whenever the float is too concentrated for the short-window signal to be
  // trustworthy.
  if (!eligible && fundamentalPrice > 0) {
    return fundamentalPrice;
  }

  return corporation.sharePrice;
}
