/**
 * Commodity-level dominance ramp and dumping-guard threshold: constants and
 * pure arithmetic only, so the build price can import it without pulling the
 * capacity chain into the constants layer.
 */

/** Potential/demand ratio at or below which the commodity toll is 1x. */
export const COMMODITY_DOMINANCE_FREE_RATIO = 0.5;
/** Build-cost multiplier when a firm's potential output equals world demand. */
export const COMMODITY_DOMINANCE_MULT_AT_PARITY = 3;
/** Build-cost multiplier at twice world demand. */
export const COMMODITY_DOMINANCE_MULT_AT_DOUBLE = 10;
/** Ratio at which the {@link COMMODITY_DOMINANCE_MULT_AT_DOUBLE} anchor sits. */
export const COMMODITY_DOMINANCE_DOUBLE_RATIO = 2;
/** Beyond the double-demand anchor the toll grows with this power of ratio / 2. */
export const COMMODITY_DOMINANCE_TAIL_EXPONENT = 2;
/** Sold share of a commodity's world supply above which negative posture is floored. */
export const DUMPING_GUARD_SOLD_SHARE = 0.5;

/**
 * Build-cost multiplier for a firm whose potential output of a commodity is
 * `ratio` times world demand. 1x up to 0.5, linear to 3x at 1.0, linear to 10x
 * at 2.0, then convex: 10 x (ratio / 2)^2. Non-finite or negative reads as 1x.
 */
export function commodityDominanceMultiplier(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= COMMODITY_DOMINANCE_FREE_RATIO) return 1;
  if (ratio <= 1) {
    const t = (ratio - COMMODITY_DOMINANCE_FREE_RATIO) / (1 - COMMODITY_DOMINANCE_FREE_RATIO);
    return 1 + (COMMODITY_DOMINANCE_MULT_AT_PARITY - 1) * t;
  }
  if (ratio <= COMMODITY_DOMINANCE_DOUBLE_RATIO) {
    const t = (ratio - 1) / (COMMODITY_DOMINANCE_DOUBLE_RATIO - 1);
    return (
      COMMODITY_DOMINANCE_MULT_AT_PARITY +
      (COMMODITY_DOMINANCE_MULT_AT_DOUBLE - COMMODITY_DOMINANCE_MULT_AT_PARITY) * t
    );
  }
  return (
    COMMODITY_DOMINANCE_MULT_AT_DOUBLE *
    Math.pow(ratio / COMMODITY_DOMINANCE_DOUBLE_RATIO, COMMODITY_DOMINANCE_TAIL_EXPONENT)
  );
}

/** True when `soldUnits` is above {@link DUMPING_GUARD_SOLD_SHARE} of `worldSupply`. */
export function isDumpingGuarded(soldUnits: number, worldSupply: number): boolean {
  if (!(worldSupply > 0) || !Number.isFinite(soldUnits) || !(soldUnits > 0)) return false;
  return soldUnits / worldSupply > DUMPING_GUARD_SOLD_SHARE;
}

/** Posture after the dumping guard: a guarded firm cannot undercut the market. */
export function guardedPricingPosture(posture: number, guarded: boolean): number {
  return guarded ? Math.max(0, posture) : posture;
}

/** One commodity's linearised toll inputs, for re-pricing order sizes. */
export interface CommodityTollModel {
  commodity: string;
  /** Player-facing name of the commodity. */
  label: string;
  /** World demand for the commodity (units/day). */
  demandUnits: number;
  /** The firm's potential output (owned plus queued) before the new order. */
  potentialUnits: number;
  /** Commodity units one new capacity unit adds to the firm's potential. */
  yieldPerUnit: number;
}

/**
 * Worst potential/demand ratio across `models` after an order of `units`. The
 * commodity toll reads the ratio AFTER the order lands, so it moves with the
 * quantity; the build dialog uses this with the shared ramp to re-price a
 * quantity locally with the arithmetic the server charges.
 */
export function worstTollRatioForOrder(
  models: readonly CommodityTollModel[],
  units: number
): number {
  let worst = 0;
  for (const m of models) {
    if (!(m.demandUnits > 0)) continue;
    const ratio = (m.potentialUnits + m.yieldPerUnit * Math.max(0, units)) / m.demandUnits;
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/** Final dominance multiplier for an order: the harsher of local and commodity tolls. */
export function dominanceMultiplierForOrder(args: {
  localMultiplier: number;
  models: readonly CommodityTollModel[];
  units: number;
}): number {
  return Math.max(
    args.localMultiplier,
    commodityDominanceMultiplier(worstTollRatioForOrder(args.models, args.units))
  );
}
