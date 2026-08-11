import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { ClearingResult } from "./types";
import type { ByCountryBalances } from "./snapshot";

/**
 * Dampened trade convergence (whole-market). Mutates `byCountry` in place so
 * each country's EFFECTIVE supply/demand moves toward balance by a fraction `k`
 * of the trade it actually did: an exporter's local supply is reduced by
 * `k × exports` (its glut is partly absorbed abroad) and an importer's local
 * demand is reduced by `k × imports` (its shortage is partly met by imports).
 *
 * The mutation propagates to every consumer of the national balances — price,
 * sector margins, inflation cost-push, and stored values — so trade relief is
 * felt market-wide, not only in price.
 *
 * `k = 0` is a no-op (exact regression guard). Effective supply/demand are
 * clamped at 0 so an oversized `k` can never produce a negative balance.
 *
 * Clearing must have been computed on the ORIGINAL (pre-dampening) balances.
 */
export function applyTradeConvergence(
  countries: CountryId[],
  byCountry: ByCountryBalances,
  clearing: Map<CommodityType, ClearingResult>,
  k: number
): void {
  if (k === 0) return;
  for (const [commodity, result] of clearing) {
    for (const c of countries) {
      const pc = result.perCountry[c];
      if (!pc) continue;
      const bal = byCountry.get(c)?.get(commodity);
      if (!bal) continue;
      if (pc.exports > 0) bal.supply = Math.max(0, bal.supply - k * pc.exports);
      if (pc.imports > 0) bal.demand = Math.max(0, bal.demand - k * pc.imports);
    }
  }
}
