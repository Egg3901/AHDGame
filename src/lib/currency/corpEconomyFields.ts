/**
 * Helpers for the non-`liquidCapital` corporate economic fields that, starting
 * v0.2.6, are stored in each corp's `liquidCurrencyCode`:
 *
 *   - Corporation.marketingBudget, logisticsBudget, ceoSalary, sharePrice
 *   - CorporateSector.revenue, currentGrowthCost
 *
 * Turn-processor math runs in ₳ (anchor). Use {@link readCorpEconomicAnchor}
 * at the top of the per-corp loop to normalize a stored local-currency value
 * into ₳. Use {@link writeCorpEconomicLocal} when persisting a computed ₳
 * value back to a stored field. Pre-forex corps (no `liquidCurrencyCode`)
 * stay in ₳ — both helpers passthrough in that case, matching the semantics
 * of `anchorToCorpCapital` / `corpCapitalToAnchor`.
 *
 * These are thin typed wrappers around the existing `corporationCapital.ts`
 * helpers. The separate naming documents the non-liquidCapital invariant so a
 * reader can tell at a glance whether a call site is converting balance-sheet
 * cash (`anchorToCorpCapital`) or a non-cash corp-economic field (this module).
 */

import type { CurrencyCode } from "@/lib/constants/currencies";
import { anchorToCorpCapital, corpCapitalToAnchor } from "./corporationCapital";

/**
 * Convert a stored corp-economic field's local-currency value into ₳ for
 * turn-processor computation. Missing/invalid `liquidCurrencyCode` or
 * non-positive `fxRate` passes the value through unchanged — same guard as
 * {@link corpCapitalToAnchor}, so pre-forex corps keep ₳ semantics.
 */
export function readCorpEconomicAnchor(
  amountLocal: number,
  liquidCurrencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  return corpCapitalToAnchor(amountLocal, liquidCurrencyCode, fxRate);
}

/**
 * Convert a computed ₳ value into the corp's local currency for persistence.
 * Missing/invalid `liquidCurrencyCode` or non-positive `fxRate` passes the
 * value through unchanged.
 */
export function writeCorpEconomicLocal(
  amountAnchor: number,
  liquidCurrencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  return anchorToCorpCapital(amountAnchor, liquidCurrencyCode, fxRate);
}
