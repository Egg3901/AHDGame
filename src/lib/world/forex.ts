import type { Db } from "mongodb";
import { COUNTRY_CURRENCY_MAP, CURRENCY_ANCHOR_COUNTRY } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ExchangeRate } from "@/lib/db/types";

/**
 * Shared forex normalization helpers for cross-country leaderboard ranking.
 *
 * Local-currency balances (campaign funds, liquid capital, …) are not directly
 * comparable across countries — $120K USD and £110K GBP are different real
 * amounts. Normalizing to internal units (local / rate) puts every country on a
 * common scale so a single ranking is meaningful.
 */

/** Fetch all exchange-rate docs keyed by their `countryId`. */
export async function fetchExchangeRateMap(db: Db): Promise<Map<string, ExchangeRate>> {
  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  return new Map(rates.map((r) => [r.countryId, r]));
}

/**
 * Effective local→internal rate for a country. Prefers the live `rate`, falls
 * back to the calibration `baseRate`, then to 1 (treat as already-internal) when
 * no rate doc exists.
 */
export function rateFromDoc(rateDoc: ExchangeRate | undefined): number {
  return rateDoc?.rate ?? rateDoc?.baseRate ?? 1;
}

/** Convert a local-currency amount to internal units via the country's rate doc. */
export function toInternalAmount(localAmount: number, rateDoc: ExchangeRate | undefined): number {
  if (!localAmount) return 0;
  const rate = rateFromDoc(rateDoc);
  return rate > 0 ? localAmount / rate : localAmount;
}

/**
 * Look up a rate doc by country id. Countries that share a currency (e.g. SCO/WAL → GBP
 * anchored by UK) have no exchangeRates doc of their own, so we resolve through the
 * currency anchor to use the correct rate. IE has its own IEP doc.
 */
export function getRateDoc(
  rateMap: Map<string, ExchangeRate>,
  countryId: CountryId
): ExchangeRate | undefined {
  const direct = rateMap.get(countryId);
  if (direct) return direct;

  const currencyCode = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode | undefined;
  const anchorCountryId = currencyCode ? CURRENCY_ANCHOR_COUNTRY[currencyCode] : undefined;
  if (anchorCountryId) {
    return rateMap.get(anchorCountryId) ?? undefined;
  }

  return undefined;
}
