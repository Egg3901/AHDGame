/**
 * Spending → metric channel (spec P0). Per-capita spending in a budget category
 * drives a derived outcome metric with diminishing returns; capital-stock metrics
 * (infrastructure, militaryReadiness) instead use maintenance-decay so they erode
 * toward "poor" unless investment offsets them. This is the GDP→budget→outcomes
 * loop the design's success-criterion #2 needs.
 *
 * `halfSaturation` and `max` are CALIBRATION inputs — each consuming metric passes
 * values tuned to its realistic per-capita spending scale (pinned per-metric in
 * P2+). The framework here only guarantees the SHAPE: monotonic, concave, bounded.
 *
 * UNITS: `ctx.spending` per-capita values arrive GDP-normalized onto the US
 * reference scale (spendingProvider × US_REFERENCE_GDP_PER_CAPITA / country
 * GDP-per-capita, #0887 RC2), so the *_SPEND_HALF_SAT constants keep their
 * #826 US-dollar calibrations for every country.
 */

/**
 * Diminishing-returns response: `max · f / (f + halfSaturation)`. Monotonic
 * increasing, concave, asymptotic to `max` (never reaches it), and `max/2` at
 * `f == halfSaturation`. Non-positive funding → 0.
 */
export function fundingResponse(perCapita: number, halfSaturation = 1, max = 100): number {
  if (!(perCapita > 0)) return 0; // also catches NaN
  return (max * perCapita) / (perCapita + halfSaturation);
}

/** Per-capita spending with a safe divide (non-positive/non-finite population → 0). */
export function perCapitaSpending(categorySpend: number, population: number): number {
  if (!Number.isFinite(population) || population <= 0) return 0;
  return categorySpend / population;
}

/**
 * Maintenance-decay for capital-stock metrics: `max(prev − decay, target)`. The
 * stock erodes by at most `decay` per turn but funding (`target`) holds it up —
 * sustained underfunding visibly degrades it, while adequate funding pins it.
 */
export function maintenanceDecay(prev: number, target: number, decay: number): number {
  return Math.max(prev - decay, target);
}
