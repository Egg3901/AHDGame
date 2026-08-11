import type { Db } from "mongodb";
import type { ExchangeRate } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Campaign treasury currency helpers.
 *
 * The campaign economy's cost / income / maintenance constants are denominated
 * in anchor (₳) so one table serves every Campaign-Manager country. The stored
 * treasury (`Campaign.funds`) and every campaign-fund balance are LOCAL currency.
 *
 * Campaign funds are deliberately DECOUPLED from live forex: they convert anchor
 * → local at the FROZEN base `INITIAL_RATES` scale, never the live `exchangeRates`
 * collection. This is the SAME base the forex system seeds each currency's
 * `baseRate` from and the SAME table starting-wealth (characterWealth.ts) uses,
 * so campaign income sits at the economy's real scale and stays stable as market
 * rates drift. It is intentionally NOT preset-aware: late-activated currencies
 * (e.g. NG) seed at the base rate regardless of the world's era, so the era
 * placeholder rate would be wildly off. Prefer `campaignAnchorToLocal` for all
 * campaign-fund flows; the live-rate `anchorToLocal` / `loadCampaignFxRate`
 * below remain only for legacy callers.
 *
 * Rate convention: `rate` is local-per-anchor, so `local = anchor × rate`.
 */

export function getCampaignCurrency(countryId: string): CurrencyCode {
  return COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD";
}

/**
 * Frozen base local scale for the campaign-fund economy. NEVER reads the live
 * exchangeRates collection — campaign funds must not move with forex. Falls back
 * to 1.0 (US parity) for unmapped countries.
 */
export function campaignLocalRate(countryId: string): number {
  return INITIAL_RATES[countryId as CountryId] ?? 1.0;
}

/** Convert an anchor campaign amount to local currency at the frozen base rate. */
export function campaignAnchorToLocal(anchor: number, countryId: string): number {
  return Math.round(anchor * campaignLocalRate(countryId));
}

/** Convert an anchor amount to local currency, rounded to a whole unit. */
export function anchorToLocal(anchor: number, rate: number): number {
  return Math.round(anchor * rate);
}

/**
 * Resolve a campaign country's local currency + FX rate. Falls back to rate 1.0
 * (anchor == local) when forex is disabled or no rate doc exists, so callers
 * never divide by an undefined rate.
 */
export async function loadCampaignFxRate(
  db: Db,
  countryId: string
): Promise<{ rate: number; currencyCode: CurrencyCode }> {
  const currencyCode = getCampaignCurrency(countryId);
  const rateDoc = await db
    .collection<ExchangeRate>("exchangeRates")
    .findOne({ currencyCode }, { projection: { rate: 1 } });
  if (!rateDoc || !Number.isFinite(rateDoc.rate) || rateDoc.rate <= 0) {
    return { rate: 1.0, currencyCode };
  }
  return { rate: rateDoc.rate, currencyCode };
}
