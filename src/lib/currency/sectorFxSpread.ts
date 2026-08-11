/**
 * Shared helper for the reduced FX spread (SECTOR_FX_SPREAD, 0.5%) charged on
 * cross-currency corp asset flows — sector expansion / growth / acquisition,
 * takeovers, HQ relocation. Centralizes the "are these two currencies different,
 * and if so what's the spread + routing" decision so every command applies it
 * identically. The caller folds `spreadAnchor` into its debit and routes the legs
 * via distributeConversionSpread(fee, from, to) after the cost is committed.
 *
 * Conservation invariant (verified for #2825 — no double-charge): this proxy is
 * the ONLY spread on these flows. Sector economics are normalized to the corp's
 * own currency in the data model — no foreign currency is actually held — so the
 * base cost is moved with pure-rate conversions (anchorToCorpLiquidCapital, no
 * embedded spread) and no real market-maker conversion runs on the same money.
 * The payer is debited base+spread exactly once, the counterparty receives the
 * plain base, and the spread legs route to central banks via
 * distributeConversionSpread — debits equal credits. If foreign sector
 * treasuries are ever re-denominated in their local currency (real conversions,
 * which carry their own spread), this helper must be retired in the same change
 * or the flow WOULD be double-charged.
 */
import {
  COUNTRY_CURRENCY_MAP,
  SECTOR_FX_SPREAD,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";

export interface SectorFxSpreadResult {
  /** Extra cost in ₳ to fold into the debit (0 when same-currency). */
  spreadAnchor: number;
  /** Source (corp) currency, or null when no spread applies. */
  from: CurrencyCode | null;
  /** Destination (counterparty) currency, or null when no spread applies. */
  to: CurrencyCode | null;
}

const NONE: SectorFxSpreadResult = { spreadAnchor: 0, from: null, to: null };

/** Resolve a country's currency, or null. */
export function currencyForCountry(countryId: string | undefined | null): CurrencyCode | null {
  if (!countryId) return null;
  return (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    null) as CurrencyCode | null;
}

/**
 * Spread on a corp paying a cost denominated against a counterparty currency.
 * `baseCostAnchor` is the pre-spread cost in ₳.
 */
export function sectorFxSpreadBetween(
  fromCcy: CurrencyCode | null | undefined,
  toCcy: CurrencyCode | null | undefined,
  baseCostAnchor: number
): SectorFxSpreadResult {
  if (!fromCcy || !toCcy || fromCcy === toCcy || !(baseCostAnchor > 0)) return NONE;
  return { spreadAnchor: baseCostAnchor * SECTOR_FX_SPREAD, from: fromCcy, to: toCcy };
}

/** Spread when a corp operates/invests in a sector located in another currency's country. */
export function corpToSectorCountrySpread(
  corp: { liquidCurrencyCode?: string | null; countryId?: string },
  sectorCountryId: string | undefined | null,
  baseCostAnchor: number
): SectorFxSpreadResult {
  const corpCcy = resolveCorpLiquidCurrencyCode(corp) as CurrencyCode | null | undefined;
  return sectorFxSpreadBetween(corpCcy, currencyForCountry(sectorCountryId), baseCostAnchor);
}
