import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { getRevenueMultiplier } from "@/lib/utils/productionPolicy";

/**
 * Realization-vs-nameplate reconciliation (#587, originally #2958).
 *
 * `sector.revenue` is a DAILY NAMEPLATE baseline written by turn processing,
 * before the realized-output multipliers the turn applies on top — market
 * clearing / sold fraction, capacity haircut, throughput, capital utilization,
 * strikes, embargo suspension. Those produce the realized `hourlyRevenue` that
 * is summed into `CorporationHistory.revenue`, which is what the Revenue/Costs
 * chart plots.
 *
 * This view used to multiply nameplate revenue by only `revenueMultiplier`, the
 * production-policy dial, and call the result "Gross Revenue". That overstated
 * revenue for any corp with unsold or clearing-haircut output — ticket #925,
 * where an oversupplied sector with low sold% showed a loss on the chart and a
 * large profit on live Financials.
 *
 * Replicating the turn processor's per-sector realization math here would
 * duplicate a large mode-gated computation that is already done correctly once
 * per turn. Instead this derives ONE per-corp ratio from the corp's own latest
 * history snapshot and applies it uniformly. For a multi-sector corp with
 * heterogeneous per-sector haircuts that is an approximation, but a large
 * improvement over assuming 100% realization, and it keeps every downstream
 * income-statement line internally consistent because they all scale off the
 * same corrected revenue.
 */
export async function computeRevenueRealizationRatio(
  db: Db,
  corporation: Pick<Corporation, "_id">,
  sectors: readonly CorporateSector[],
  toCorpCurrency: (amount: number, sector: Pick<CorporateSector, "countryId">) => number
): Promise<number> {
  const latest = await db
    .collection<{ revenue?: number }>("corporationHistory")
    .findOne(
      { corporationId: corporation._id },
      { sort: { turn: -1 }, projection: { revenue: 1 } }
    );

  const nameplateHourly = sectors.reduce((sum, sector) => {
    const multiplier = getRevenueMultiplier(sector.productionPolicyLevel ?? 0);
    return sum + (toCorpCurrency(sector.revenue, sector) * multiplier) / TURNS_PER_DAY;
  }, 0);

  const realizedHourly = typeof latest?.revenue === "number" ? latest.revenue : null;

  // No history yet (brand-new corp) or a degenerate nameplate total ⇒ there is
  // no correction we can trust. Fall back to the pre-fix nameplate behaviour
  // rather than dividing by ~0 or applying a ratio computed from nothing.
  if (realizedHourly == null || nameplateHourly <= 0) return 1;
  return Math.max(0, realizedHourly / nameplateHourly);
}
