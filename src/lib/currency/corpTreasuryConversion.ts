import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types";

/**
 * Build a currencyCode → rate map from `exchangeRates` docs.
 * `rate` is local currency per 1 sector-economy internal unit (see ExchangeRate type).
 */
export function buildFxLocalPerInternalMap(
  exchangeRateDocs: Array<{ currencyCode?: CurrencyCode; rate?: number }>
): Map<CurrencyCode, number> {
  const fxByCurrency = new Map<CurrencyCode, number>();
  for (const r of exchangeRateDocs) {
    if (r.currencyCode != null && typeof r.rate === "number") {
      fxByCurrency.set(r.currencyCode, r.rate);
    }
  }
  if (!fxByCurrency.has("USD")) {
    fxByCurrency.set("USD", 1.0);
  }
  return fxByCurrency;
}

export function getFxLocalPerInternalForCorpHome(
  corporation: Pick<Corporation, "countryId">,
  fxByCurrency: Map<CurrencyCode, number>
): number {
  const code = COUNTRY_CURRENCY_MAP[corporation.countryId as CountryId] ?? "USD";
  return fxByCurrency.get(code) ?? 1.0;
}

/**
 * Corporate-sector revenue, unowned pools, and split/attack cost formulas all live in the
 * shared sector-economy internal scale (USD-equivalent after CountryConfig.usdExchangeRate on
 * state GDP — see JP sector currency fix). Post-forex corporations store `liquidCapital` in
 * their home currency (`liquidCurrencyCode`). Scale internal cash costs before comparing or
 * incrementing liquidCapital so JP/UK treasuries pay the correct local amount.
 */
export function internalSectorCostToTreasuryLiquidUnits(
  internalAmount: number,
  corporation: Pick<Corporation, "liquidCurrencyCode" | "countryId">,
  fxLocalPerInternal: number
): number {
  if (!corporation.liquidCurrencyCode) {
    return Math.round(internalAmount);
  }
  return Math.round(internalAmount * fxLocalPerInternal);
}
