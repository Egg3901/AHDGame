/**
 * Cross-currency bond principal + interest summation.
 *
 * Post-v0.2.6 (Task 18B), `bond.totalIssued` is denominated in `bond.currencyCode`
 * — the issuer's currency. Naively summing across a bond list mixes units when
 * the corp's bonds straddle currencies or when comparing the sum against
 * `₳`-denominated corp equity / liquid capital. These helpers normalize every
 * bond's principal (or annual coupon) to ₳ before summing, so the result is
 * safe to compare against `liquidCapitalAnchor`, `totalEquity`, or any other
 * ₳-denominated corp metric.
 *
 * Passthrough semantics (match {@link corpCapitalToAnchor}):
 *   - Pre-v0.2.6 bond with no `currencyCode` → rate=1, treated as-if ₳.
 *   - `currencyCode` set but missing from `fxByCurrency` map → rate=1 fallback
 *     (same convention as every other bond-FX site in the codebase). Defensive
 *     against admin mis-seeding, new-currency-added-without-rate-row, or
 *     turn-running-before-rate-refresh edge cases.
 *   - Zero/negative rate → treated as-if ₳ (via corpCapitalToAnchor guard).
 *
 * Callers filter `bonds` themselves (matured / defaulted / issuerType / corpId
 * filters differ per call site). Keeping the helpers unfiltered avoids a
 * combinatorial explosion of variants.
 */

import type { Bond } from "@/lib/db/types/bond";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";

/**
 * Σ `b.totalIssued` normalized to ₳ via each bond's `currencyCode`.
 * Safe to compare against `liquidCapitalAnchor` / `totalEquity` / other ₳ sums.
 */
export function sumBondPrincipalAnchor(
  bonds: Bond[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  let sum = 0;
  for (const bond of bonds) {
    const code = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const rate = code ? (fxByCurrency.get(code) ?? 1) : 1;
    sum += corpCapitalToAnchor(bond.totalIssued ?? 0, code, rate);
  }
  return sum;
}

/**
 * Σ `(couponRate% × totalIssued)` normalized to ₳.
 * Use alongside {@link sumBondPrincipalAnchor} to feed ₳-unit inputs to the
 * credit scorer (debt, annual interest payments).
 */
export function sumBondAnnualInterestAnchor(
  bonds: Bond[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  let sum = 0;
  for (const bond of bonds) {
    const code = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const rate = code ? (fxByCurrency.get(code) ?? 1) : 1;
    const annualLocal = ((bond.couponRate ?? 0) / 100) * (bond.totalIssued ?? 0);
    sum += corpCapitalToAnchor(annualLocal, code, rate);
  }
  return sum;
}
