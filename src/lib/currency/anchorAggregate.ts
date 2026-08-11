/**
 * Cross-entity aggregation helper. Sums a stream of (amount, currencyCode,
 * fxRate) tuples into a single ₳ (anchor) total, converting each entry from
 * its stored currency before accumulation. Use this wherever code needs to
 * sum money across different corps / countries / bonds — raw accumulation
 * would silently mix currencies once the v0.2.6 local-currency migration
 * ships.
 *
 * Pre-forex entries (missing/blank currency code) are treated as already-
 * anchor and passthrough. Non-positive / non-finite rates also passthrough,
 * matching the guard in `corpCapitalToAnchor` so the function never returns
 * NaN or Infinity unless the input already was.
 *
 * Typical call sites:
 *   - GDP growth weighting across all sectors in a country
 *   - Subsidy cost aggregation across qualifying sectors
 *   - Commodity supply/demand rollup across corps in a market
 *   - Stockmarket "total market cap" / "total revenue" admin aggregates
 *   - Public-enterprise revenue summation for a country
 */

import { corpCapitalToAnchor } from "./corporationCapital";

export interface AnchorAggregateEntry {
  amount: number;
  code?: string | null;
  fxRate: number;
}

/**
 * Reduce a list of per-entity (amount, code, rate) tuples to a single ₳ sum.
 * Each entry's local-currency amount is converted to ₳ via
 * {@link corpCapitalToAnchor} before being added.
 */
export function sumAsAnchor(entries: Iterable<AnchorAggregateEntry>): number {
  let sum = 0;
  for (const e of entries) {
    sum += corpCapitalToAnchor(e.amount, e.code, e.fxRate);
  }
  return sum;
}
