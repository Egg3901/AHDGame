/**
 * P1 units telemetry ("buildable sectors"): the units-denominated twin of the
 * dollar realization chain, so a sector's trace can be read in physical output
 * instead of only in ₳.
 *
 * The dollar chain is
 *   realizedRevenue = nameplateRevenue × productionLegs × salesLegs
 * where the PRODUCTION legs gate how much the sector can physically make this
 * turn (production policy, nationalization transition, extraction capacity
 * haircut, input throughput, capital utilization, strike) and the SALES legs
 * only decide what the output fetches or how much of it clears (the
 * clearing/price leg, the embargo export strip).
 *
 * Splitting the chain there gives the identity this helper pins:
 *   producedUnits = impliedOutputUnits(nameplateRevenue) × productionFactor
 *   realizedRevenue = producedUnits × mixPrice × salesLegs
 * with mixPrice = nameplateRevenue / impliedOutputUnits(nameplateRevenue),
 * the same Σ rate/basePrice mix the capital tier already prices output with.
 * Both are DAILY, currency-free counts.
 *
 * `soldUnits` is producedUnits × soldFraction when the clearing pre-pass ran,
 * else producedUnits. The embargo leg is deliberately NOT folded into
 * soldUnits: it strips revenue, not clearing volume, and lives on the dollar
 * side of the identity above.
 *
 * Telemetry only: never read back into the economy.
 */
export function computeSectorOutputUnits(args: {
  /** impliedOutputUnits of the sector's nameplate (pre-realization) revenue. */
  nameplateUnits: number;
  /** Product of the production-side legs of the realization chain. */
  productionFactor: number;
  /** clearing.soldFraction when the clearing pre-pass ran, else null. */
  soldFraction: number | null;
}): { producedUnits: number; soldUnits: number } {
  const { nameplateUnits, productionFactor, soldFraction } = args;
  const producedUnits =
    Number.isFinite(nameplateUnits) && Number.isFinite(productionFactor)
      ? Math.max(0, nameplateUnits * productionFactor)
      : 0;
  const soldUnits =
    soldFraction != null && Number.isFinite(soldFraction)
      ? producedUnits * Math.max(0, soldFraction)
      : producedUnits;
  return { producedUnits, soldUnits };
}
