/**
 * Revenue figures for ventures, in anchor currency per turn. Sector revenue is
 * stored per day in the host state's currency, so it is converted here once.
 */
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  corpCapitalToAnchor,
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { Corporation, CorporateSector } from "@/lib/db/types";

export function sectorTurnRevenueAnchor(
  sector: Pick<CorporateSector, "countryId" | "realizedRevenue" | "revenue">,
  corp: Pick<Corporation, "countryId" | "liquidCurrencyCode">,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const daily = sector.realizedRevenue ?? sector.revenue ?? 0;
  if (!Number.isFinite(daily) || daily <= 0) return 0;
  const code = resolveSectorHostCurrencyCode(sector, corp);
  const fx = fxRateForSectorHostFromMap(sector, corp, fxByCurrency);
  return corpCapitalToAnchor(daily / TURNS_PER_DAY, code, fx);
}

/**
 * Last settled plant profit per turn in anchor currency, signed. Stored on the
 * same per-day basis as revenue. Zero when the sector has no plant P&L yet.
 */
export function sectorTurnProfitAnchor(
  sector: Pick<CorporateSector, "countryId" | "plantsPnl">,
  corp: Pick<Corporation, "countryId" | "liquidCurrencyCode">,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const daily = sector.plantsPnl?.profit;
  if (typeof daily !== "number" || !Number.isFinite(daily) || daily === 0) return 0;
  const code = resolveSectorHostCurrencyCode(sector, corp);
  const fx = fxRateForSectorHostFromMap(sector, corp, fxByCurrency);
  return corpCapitalToAnchor(daily / TURNS_PER_DAY, code, fx);
}
