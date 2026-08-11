import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Era-aware correction for commodity demand generators.
 *
 * Several demand generators convert MONEY into demand UNITS by dividing a
 * budget by the commodity's base price — `MARKETING_ADVERTISING_DEMAND_RATE` is
 * the clearest case:
 *
 *     units = budgetAnchor * RATE / basePrice
 *
 * Base prices are era-scaled (`eraScaledBasePrices`), and because the base price
 * sits in the DENOMINATOR, the conversion is era-sensitive in a way the rate
 * constants were never calibrated for. `MARKETING_ADVERTISING_DEMAND_RATE`'s own
 * doc calibrates against a **$150** advertising base price; a 1953 world runs
 * **2.15** — a factor of 69.8, which is exactly `getEraUnitScale("1953")`.
 *
 * The symptom, measured on a 400-turn 1953 soak at the `ledger` tier: advertising
 * supply/demand **0.03** (97% of demand unmet, permanently, with zero stock).
 * The rate had already been cut 0.60 → 0.40 when a modern world measured 0.38, so
 * the same constant degrades ~13x between eras. Correcting it globally would fix
 * 1953 and break the era it was calibrated against, which is why this table is
 * keyed by era and defaults to inert.
 *
 * Supply cannot absorb the difference: `buildCapacity` is gated on the `plants`
 * market tier and production policy is already pinned at its +25 clamp (a +10%
 * revenue lever) across every starved sector, so nothing in a `ledger` world can
 * answer a shortage of this size.
 *
 * Values are the reciprocal of the measured supply/demand ratio, targeting ~0.9
 * (slightly supply-short, so scarcity still has meaning). Only 1953 is corrected
 * because it is the only era with measured flow data; **every other era resolves
 * to 1.0 and is byte-identical to today.**
 */
export const COMMODITY_DEMAND_CALIBRATION: Record<
  string,
  Partial<Record<CommodityType, number>>
> = {
  "1953": {
    // measured S/D 0.03 — the worst miscalibration in the economy by an order
    // of magnitude, and the one the era/base-price interaction explains.
    advertising: 0.035,
    // measured 0.11 / 0.13. Both are money-scaled generators (household health
    // spending, industrial gas draw) against unit-scaled supply.
    natural_gas: 0.13,
    healthcare_services: 0.15,
    // measured 0.40 / 0.50 / 0.50 — same shape, milder.
    iron: 0.45,
    oil: 0.55,
    energy: 0.55,
  },
};

/**
 * Demand multiplier for one commodity in one era. Returns 1 for every era and
 * commodity without an authored correction, so callers multiply unconditionally.
 */
export function commodityDemandCalibration(
  era: string | null | undefined,
  commodity: CommodityType
): number {
  if (!era) return 1;
  return COMMODITY_DEMAND_CALIBRATION[era]?.[commodity] ?? 1;
}
