import type { Corporation } from "@/lib/db/types";
import { SHARE_EXECUTION_PRICE_BAND_MAX_RATIO } from "@/lib/constants/corporations";

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

/**
 * Sanity band for share execution prices, anchored on fundamentalSharePrice:
 * [fundamental / K, fundamental * K], K = SHARE_EXECUTION_PRICE_BAND_MAX_RATIO.
 *
 * Returns null when the corp has no positive fundamental to anchor on (freshly
 * founded / never turn-priced corps), in which case callers execute unclamped
 * as before. The fundamental itself is guarded upstream (issuance dilution
 * scaling + the split-cooldown anchor clamp in sharePriceFormula), so it can
 * no longer be poisoned by the live price the way it was in the 2026-08-20
 * incident; anchoring the band on it is then safe defense in depth.
 */
export function shareExecutionPriceBand(
  corporation: Pick<Corporation, "fundamentalSharePrice">
): { min: number; max: number } | null {
  const fundamentalPrice = corporation.fundamentalSharePrice ?? 0;
  if (!Number.isFinite(fundamentalPrice) || fundamentalPrice <= 0) return null;
  return {
    min: fundamentalPrice / SHARE_EXECUTION_PRICE_BAND_MAX_RATIO,
    max: fundamentalPrice * SHARE_EXECUTION_PRICE_BAND_MAX_RATIO,
  };
}

/** True when `price` is inside the corp's execution sanity band (or no band exists). */
export function isWithinShareExecutionBand(
  corporation: Pick<Corporation, "fundamentalSharePrice">,
  price: number
): boolean {
  const band = shareExecutionPriceBand(corporation);
  if (!band) return true;
  return price >= band.min && price <= band.max;
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

  // Clamp the live price into the fundamental-anchored sanity band. All
  // market-price executions (buys, sells into the instant buyback, CEO
  // self-issuance premium) route through here, so a manipulated live price
  // can move real money by at most the band ratio.
  const band = shareExecutionPriceBand(corporation);
  if (band) {
    return Math.min(band.max, Math.max(band.min, corporation.sharePrice));
  }

  return corporation.sharePrice;
}
