import type { Corporation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  RELOCATION_COST_FRACTION,
  CROSS_COUNTRY_RELOCATION_MULTIPLIER,
} from "@/lib/constants/corporations";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";

export interface CorpRelocationCost {
  /** Cost in anchor currency (₳), rounded to whole units */
  cost: number;
  /** True when target country differs from corporation.countryId */
  crossCountry: boolean;
  /** sharePrice × totalShares in ₳ (unrounded) */
  baseMarketCap: number;
}

/**
 * Compute the relocation cost for moving a corporation's HQ to a new state.
 * In-country: 7% of market cap. Cross-country: 14% (2×).
 *
 * `sharePrice × totalShares` is in the corp's home currency post-v0.2.6;
 * pass `corpFxRate` (local per 1 ₳ for `corporation.liquidCurrencyCode`) so
 * the returned cost matches the ₳ units that bond issuance / credit scoring
 * expect. Pre-forex corps (no `liquidCurrencyCode`) pass through at rate=1.
 */
export function computeCorpRelocationCost(
  corporation: Pick<Corporation, "sharePrice" | "totalShares" | "countryId" | "liquidCurrencyCode">,
  targetCountryId: CountryId,
  corpFxRate: number
): CorpRelocationCost {
  const baseMarketCapLocal = corporation.sharePrice * corporation.totalShares;
  const baseMarketCap = corpLiquidCapitalToAnchor(baseMarketCapLocal, corporation, corpFxRate);
  const crossCountry = targetCountryId !== corporation.countryId;
  const multiplier = crossCountry ? CROSS_COUNTRY_RELOCATION_MULTIPLIER : 1;
  const cost = Math.round(baseMarketCap * RELOCATION_COST_FRACTION * multiplier);
  return { cost, crossCountry, baseMarketCap };
}
