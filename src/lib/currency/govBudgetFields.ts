/**
 * Helpers for government-budget money fields that, starting v0.2.6, are
 * stored in each country's currency:
 *
 *   - FederalBudget.revenue.*, taxBases.*, spending.*, debt.{principal,ceiling},
 *     surplus, gdp
 *   - StateBudget.revenue.*, taxBases.*, spending.*, balance, surplus, stateGdp
 *   - EnactedLaw.annualCostUsd (legacy field name; is actually country currency)
 *
 * Resolution order for the entity's currency code:
 *   1. Explicit `currencyCode` on the doc (`FederalBudget.currencyCode`
 *      already exists on the type).
 *   2. `COUNTRY_CURRENCY_MAP[countryId]` as fallback.
 *
 * State budgets inherit from their parent country via the same resolver.
 *
 * Turn math runs in ₳. Use {@link readGovBudgetAnchor} at the top of a turn
 * phase to normalize a stored local value into ₳. Use
 * {@link writeGovBudgetLocal} to re-denominate a computed ₳ result back to
 * the country's currency for persistence. Missing/invalid currency or rate
 * passes through unchanged, matching corp-side helper semantics.
 */

import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { anchorToCorpCapital, corpCapitalToAnchor } from "./corporationCapital";

export interface CountryCurrencyInfo {
  countryId?: string | null;
  currencyCode?: CurrencyCode | string | null;
}

/**
 * Resolve an entity's currency code from either an explicit `currencyCode`
 * field or its `countryId` via {@link COUNTRY_CURRENCY_MAP}. Returns
 * `undefined` when neither yields a known currency — caller should treat
 * that as pre-forex passthrough.
 */
export function resolveCountryCurrencyCode(
  info: CountryCurrencyInfo | null | undefined
): CurrencyCode | undefined {
  if (!info) return undefined;
  const raw = info.currencyCode;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return raw as CurrencyCode;
  }
  if (info.countryId && info.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[info.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return undefined;
}

/**
 * Convert a stored gov-budget field's country-currency value into ₳ for
 * turn-processor computation. Missing currency or non-positive rate passes
 * the value through unchanged.
 */
export function readGovBudgetAnchor(
  amountLocal: number,
  currencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  return corpCapitalToAnchor(amountLocal, currencyCode, fxRate);
}

/**
 * Convert a computed ₳ value into the country's currency for persistence.
 * Missing currency or non-positive rate passes the value through unchanged.
 */
export function writeGovBudgetLocal(
  amountAnchor: number,
  currencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  return anchorToCorpCapital(amountAnchor, currencyCode, fxRate);
}
