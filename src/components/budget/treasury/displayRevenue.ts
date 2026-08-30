import type { FederalRevenue } from "@/lib/db/types/budget";

const DIAGNOSTIC_FIELDS = new Set<keyof FederalRevenue>([
  "total",
  "taxLikeRevenue",
  "taxLikeRevenueAfterCap",
  "revenueCapReduction",
]);

const NON_TAX_FIELDS = new Set<keyof FederalRevenue>(["healthcareIncome", "other"]);

/**
 * Convert the persisted revenue ledger into independent receipt lines for charts.
 *
 * The three era-cap fields are explanatory aggregates, not additional income.
 * When the cap is active, proportionally compress the underlying tax ribbons so
 * the visible lines reconcile exactly to the authoritative revenue total.
 */
export function displayRevenueEntries(revenue: FederalRevenue): [string, number][] {
  const entries = (Object.entries(revenue) as [keyof FederalRevenue, number][]).filter(
    ([key]) => !DIAGNOSTIC_FIELDS.has(key)
  );
  const grossTax = revenue.taxLikeRevenue;
  const cappedTax = revenue.taxLikeRevenueAfterCap;

  if (
    grossTax == null ||
    cappedTax == null ||
    !Number.isFinite(grossTax) ||
    !Number.isFinite(cappedTax) ||
    grossTax <= 0
  ) {
    return entries;
  }

  const factor = cappedTax / grossTax;
  const scaled = entries.map(([key, value]) => [
    key,
    NON_TAX_FIELDS.has(key) ? value : value * factor,
  ]) as [keyof FederalRevenue, number][];

  // Absorb floating-point residue into the largest tax line so callers can use
  // these values directly in a stacked bar without drifting from the ledger.
  const taxLines = scaled.filter(([key]) => !NON_TAX_FIELDS.has(key));
  const displayedTax = taxLines.reduce((sum, [, value]) => sum + value, 0);
  const largestTax = taxLines.reduce<[keyof FederalRevenue, number] | null>(
    (largest, line) => (!largest || line[1] > largest[1] ? line : largest),
    null
  );
  if (largestTax) {
    const line = scaled.find(([key]) => key === largestTax[0]);
    if (line) line[1] += cappedTax - displayedTax;
  }

  return scaled;
}
