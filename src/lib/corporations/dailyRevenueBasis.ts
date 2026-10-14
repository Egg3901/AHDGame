import type { CorporateSector } from "@/lib/db/types";
import { getRevenueMultiplier } from "@/lib/utils/productionPolicy";

type RevenueSector = Pick<
  CorporateSector,
  "countryId" | "revenue" | "realizedRevenue" | "freightBillingCredit" | "productionPolicyLevel"
>;

/**
 * The daily gross-revenue basis shown in CEO Financials and used by the
 * operating-budget ceiling. Sector amounts are restated from host currency to
 * the corporation's home currency before summing. Realized revenue already
 * includes production policy and market realization; older sectors fall back
 * to nameplate × policy × the corporation-history realization ratio.
 */
export function sectorDailyRevenueBasis(
  sector: RevenueSector,
  revenueRealizationRatio: number,
  toCorpCurrency: (amount: number, sector: Pick<CorporateSector, "countryId">) => number
): {
  nameplateRevenueLocal: number;
  realizedRevenueLocal: number | null;
  freightIncomeLocal: number;
  financialRevenueLocal: number;
} {
  const convert = (amount: number) => {
    const converted = toCorpCurrency(amount, sector);
    return Number.isFinite(converted) ? converted : 0;
  };
  const nameplateRevenueLocal = convert(Number.isFinite(sector.revenue) ? sector.revenue : 0);
  const realizedRevenueLocal =
    typeof sector.realizedRevenue === "number" && Number.isFinite(sector.realizedRevenue)
      ? convert(sector.realizedRevenue)
      : null;
  const freightIncomeLocal = convert(
    typeof sector.freightBillingCredit === "number" && Number.isFinite(sector.freightBillingCredit)
      ? sector.freightBillingCredit
      : 0
  );
  const fallbackRatio = Number.isFinite(revenueRealizationRatio)
    ? Math.max(0, revenueRealizationRatio)
    : 1;
  const operatingRevenue =
    realizedRevenueLocal ??
    nameplateRevenueLocal * getRevenueMultiplier(sector.productionPolicyLevel ?? 0) * fallbackRatio;

  return {
    nameplateRevenueLocal,
    realizedRevenueLocal,
    freightIncomeLocal,
    financialRevenueLocal: operatingRevenue + freightIncomeLocal,
  };
}
