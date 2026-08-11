import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Build the aggregation-pipeline `$set` expressions that route an anchor-denominated
 * cash-on-hand grant into each character's home-currency personal bucket.
 *
 * Keyed by *currency code*, not country, for two reasons:
 *
 *  1. **No bucket collisions.** Currencies shared by multiple countries (GBP is
 *     the home currency of UK + SCO + WAL) must accumulate every country into a
 *     nested `$cond`. The previous per-country loop wrote
 *     `currencyBalances.personal.EUR` once per country, so the later write
 *     silently clobbered the earlier one.
 *
 *  2. **One rate per currency.** Holders of the same currency convert ₳ at the
 *     same rate. `exchangeRates` is keyed by country, and only the currency's
 *     anchor country (e.g. DE for EUR, IE for IEP) carries a doc, so we resolve
 *     the rate via `getCountryIdForCurrency` and apply it to every country
 *     sharing that currency.
 *
 * @param cashOnHand Grant amount in anchor units (USD-equivalent, rate 1.0).
 * @param rateByCountry Live FX rates keyed by anchor countryId (from `exchangeRates`).
 */
export function buildHomeCurrencyCashGrantSetStage(
  cashOnHand: number,
  rateByCountry: Map<string, number>
): Record<string, unknown> {
  // Group countries by the currency they use.
  const countriesByCurrency = new Map<CurrencyCode, CountryId[]>();
  for (const [countryId, code] of Object.entries(COUNTRY_CURRENCY_MAP) as Array<
    [CountryId, CurrencyCode]
  >) {
    const list = countriesByCurrency.get(code) ?? [];
    list.push(countryId);
    countriesByCurrency.set(code, list);
  }

  const setStage: Record<string, unknown> = {};
  for (const [currencyCode, countryIds] of countriesByCurrency) {
    const path = `currencyBalances.personal.${currencyCode}`;
    // One rate for the whole currency, resolved via its anchor country.
    const anchorCountry = getCountryIdForCurrency(currencyCode);
    const rate = rateByCountry.get(anchorCountry) ?? INITIAL_RATES[anchorCountry] ?? 1;
    const convertedAmount = cashOnHand * rate;

    // Build a nested $cond that pays every country sharing this currency.
    let expr: Record<string, unknown> = { $ifNull: [`$${path}`, 0] };
    for (const countryId of [...countryIds].reverse()) {
      expr = {
        $cond: {
          if: { $eq: ["$countryId", countryId] },
          then: { $add: [{ $ifNull: [`$${path}`, 0] }, convertedAmount] },
          else: expr,
        },
      };
    }
    setStage[path] = expr;
  }
  return setStage;
}

/**
 * Build the aggregation expression that converts an anchor-denominated campaign-funds
 * grant into each character's home currency and adds it to the single
 * `currencyBalances.campaign` scalar.
 *
 * Unlike the personal buckets there is no field collision here (campaign is one scalar),
 * but the rate must still be resolved per *currency*, not per country, so that countries
 * sharing a currency (UK + SCO/WAL → GBP) convert at the same rate.
 *
 * @param funds Grant amount in anchor units (USD-equivalent, rate 1.0).
 * @param rateByCountry Live FX rates keyed by anchor countryId (from `exchangeRates`).
 */
export function buildCampaignFundsGrantExpression(
  funds: number,
  rateByCountry: Map<string, number>
): Record<string, unknown> {
  const pairs = Object.entries(COUNTRY_CURRENCY_MAP) as Array<[CountryId, CurrencyCode]>;
  let expr: Record<string, unknown> = { $ifNull: ["$currencyBalances.campaign", 0] };
  for (const [countryId, currencyCode] of [...pairs].reverse()) {
    const anchorCountry = getCountryIdForCurrency(currencyCode);
    const rate = rateByCountry.get(anchorCountry) ?? INITIAL_RATES[anchorCountry] ?? 1;
    expr = {
      $cond: {
        if: { $eq: ["$countryId", countryId] },
        then: { $add: [{ $ifNull: ["$currencyBalances.campaign", 0] }, funds * rate] },
        else: expr,
      },
    };
  }
  return expr;
}
