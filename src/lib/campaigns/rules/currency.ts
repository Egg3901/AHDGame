/**
 * Campaign money uses a world's frozen currency basis for income and costs.
 * campaignLocalRate accepts the loaded base-rate snapshot, so live exchange-rate
 * movements never change political purchasing power or cross world boundaries.
 */
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

export type CampaignCurrencyRates = Partial<Record<CurrencyCode, number>>;
export function getCampaignCurrency(countryId: string): CurrencyCode {
  return COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD";
}
export function campaignLocalRate(countryId: string, rates?: CampaignCurrencyRates | null): number {
  const rate = rates?.[getCampaignCurrency(countryId)];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : (INITIAL_RATES[countryId as CountryId] ?? 1);
}
export function campaignAnchorToLocal(
  anchor: number,
  countryId: string,
  rates?: CampaignCurrencyRates | null
): number {
  return Math.round(anchor * campaignLocalRate(countryId, rates));
}
