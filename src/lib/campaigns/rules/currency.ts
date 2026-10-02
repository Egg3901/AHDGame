/**
 * Campaign money uses a world's frozen currency basis for income and costs.
 * campaignLocalRate accepts the loaded base-rate snapshot, so live exchange-rate
 * movements never change political purchasing power or cross world boundaries.
 */
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  getSeedCurrencyCode,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

export type CampaignCurrencyRates = Partial<Record<CurrencyCode, number>>;
/**
 * Frozen campaign-money currency for a country. Preset-aware: a 2027-default
 * run prices euro members in EUR (the denomination their war chests were
 * migrated into); an omitted preset keeps the legacy era-blind map behavior.
 * `preset` is plain world data, so this stays a portable rules function.
 */
export function getCampaignCurrency(countryId: string, preset?: string): CurrencyCode {
  if (preset !== undefined) return getSeedCurrencyCode(countryId as CountryId, preset);
  return COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD";
}
export function campaignLocalRate(
  countryId: string,
  rates?: CampaignCurrencyRates | null,
  preset?: string
): number {
  const rate = rates?.[getCampaignCurrency(countryId, preset)];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : (INITIAL_RATES[countryId as CountryId] ?? 1);
}
export function campaignAnchorToLocal(
  anchor: number,
  countryId: string,
  rates?: CampaignCurrencyRates | null,
  preset?: string
): number {
  return Math.round(anchor * campaignLocalRate(countryId, rates, preset));
}
