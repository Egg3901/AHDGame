import type { CorporateSector } from "@/lib/db/types";

/**
 * The revenue figure valuation/NPV math should use for a sector, in the sector's
 * home currency.
 *
 * Prefers the persisted per-sector `realizedRevenue` (nameplate after every
 * realization leg — production policy, capacity haircut, clearing/soldFraction,
 * throughput, capital utilization, strike, embargo) that the turn processor
 * writes, falling back to raw nameplate `revenue` for sectors not yet
 * reprocessed. This is the same basis the corp Financials page adopted in
 * #3001/#3002, so every "what is this sector/corp worth" surface (corp page,
 * credit model, sector listing, dissolution salvage, Discord cards) agrees
 * instead of some using nameplate and overstating.
 */
export function sectorEconomicRevenue(
  sector: Pick<CorporateSector, "revenue" | "realizedRevenue">
): number {
  return typeof sector.realizedRevenue === "number"
    ? sector.realizedRevenue
    : (sector.revenue ?? 0);
}
