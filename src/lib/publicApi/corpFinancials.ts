/**
 * Why your corporation lost money: the revenue, operating income and operating
 * costs shown on the public API. corpFinancials sums each sector's realized
 * revenue (not its nameplate), applies the margin the engine actually used
 * (effectiveProfitMargin), and converts each sector from its host currency first.
 */
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";

/**
 * Corporation financials on the canonical basis:
 *
 *   - realized revenue via `sectorEconomicRevenue`, NOT the nameplate
 *     `sector.revenue`;
 *   - `effectiveProfitMargin`, the margin the engine actually applied, falling
 *     back to the CEO-set `profitMargin` only when the sector predates it;
 *   - each sector converted from its HOST currency before summing.
 *
 * The public API previously got all three wrong while its comment claimed it
 * "mirrors the per-sector basis the internal corporation detail view uses". At
 * turn 366, 3,403 of 3,805 sectors had `profitMargin` and `effectiveProfitMargin`
 * more than 5 points apart (means 26.4 vs 36.2), and 67 corporations hold
 * sectors in two or more countries, so the un-converted sum added currencies.
 *
 * The FX rule is the one `dailyGrossRevenue.ts` adopted under ticket #1118: a
 * sector earns in the market it operates in, not its parent's home currency.
 */
export interface CorpFinancialsInput {
  sectors: Array<{
    _id?: unknown;
    revenue?: number;
    realizedRevenue?: number;
    profitMargin?: number;
    effectiveProfitMargin?: number;
  }>;
  /** Host-currency FX rate per sector id. A missing or non-positive entry means 1. */
  hostRateBySectorId: Map<string, number>;
}

export interface CorpFinancials {
  totalRevenue: number;
  operatingIncome: number;
  operatingCosts: number;
}

export function corpFinancials(input: CorpFinancialsInput): CorpFinancials {
  let totalRevenue = 0;
  let operatingIncome = 0;

  for (const sector of input.sectors) {
    const rate = input.hostRateBySectorId.get(String(sector._id ?? ""));
    const divisor = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
    // `sectorEconomicRevenue` takes a non-optional `revenue`; normalising here
    // keeps its contract intact and is behaviour-identical (it already treats a
    // missing nameplate as 0).
    const revenue =
      sectorEconomicRevenue({
        revenue: sector.revenue ?? 0,
        realizedRevenue: sector.realizedRevenue,
      }) / divisor;

    const effective = sector.effectiveProfitMargin;
    const margin =
      typeof effective === "number" && Number.isFinite(effective)
        ? effective
        : (sector.profitMargin ?? 0);

    totalRevenue += revenue;
    operatingIncome += revenue * (margin / 100);
  }

  return {
    totalRevenue,
    operatingIncome,
    operatingCosts: totalRevenue - operatingIncome,
  };
}
