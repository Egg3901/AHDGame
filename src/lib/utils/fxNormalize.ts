/**
 * Static base exchange rates (local currency per 1 USD).
 * Sourced from exchangeRates.baseRate at game seed time.
 * Used to normalize currency-valued state metrics to USD for
 * cross-country scoring and margin calculations.
 *
 * Live rates fluctuate ±10% around these; for threshold scoring
 * the difference is negligible.
 */
const BASE_RATES_USD: Record<string, number> = {
  US: 1,
  UK: 0.75,
  JP: 106,
  DE: 0.92,
  CN: 7.2,
  BR: 5.0,
  IE: 0.92,
  NG: 1,
};

/**
 * Convert a local-currency value to USD using base exchange rates.
 * Returns the value unchanged if the country is unknown.
 */
export function toUsd(localValue: number, countryId: string): number {
  const rate = BASE_RATES_USD[countryId];
  if (!rate || rate === 1) return localValue;
  return localValue / rate;
}
