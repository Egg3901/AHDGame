import {
  getCountryIdForCurrency,
  getInitialRates,
  INITIAL_RATES,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/** Match the claim's home-currency credit in the profile reward preview. */
export function onboardingRewardLocalAmount(
  anchorAmount: number,
  forexEnabled: boolean,
  homeCurrency: CurrencyCode,
  storedRate?: number,
  preset?: string
): number {
  if (!forexEnabled) return anchorAmount;
  const anchorCountry = getCountryIdForCurrency(homeCurrency);
  const fallbackRate =
    getInitialRates(preset ?? "")[anchorCountry as CountryId] ??
    INITIAL_RATES[anchorCountry as CountryId] ??
    1;
  const homeRate =
    storedRate !== undefined && Number.isFinite(storedRate) && storedRate > 0
      ? storedRate
      : fallbackRate;
  return Math.round(anchorAmount * homeRate);
}
