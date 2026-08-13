import { getCountryConfig, type CountryId } from "@/lib/constants/countries";

/**
 * Convert a national-budget amount (stored in the country's seed unit) into
 * era-dollar ₳, or `null` when the figure is already USD-of-the-era.
 *
 * Uses `CountryConfig.usdExchangeRate` — the GDP/budget denomination
 * normalizer — not live forex. Live FX would rescale 1953 IT/JP/CN/NG
 * (authored in USD millions) and 2019 UK (seeded in dollars, labelled £).
 * A rate of 1 means "this number is already the dollar of the era"; we
 * return null so the UI does not print a redundant `≈ $X` next to `$X`.
 *
 * Client-safe: do not import `gdpAnchorRate.ts` (it pulls mongodb).
 */
export function budgetUsdEquivalent(
  localAmount: number,
  countryId: CountryId,
  preset?: string | null
): number | null {
  if (!Number.isFinite(localAmount)) return null;
  const rate = getCountryConfig(countryId, preset ?? undefined)?.usdExchangeRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  if (Math.abs(rate - 1) < 1e-9) return null;
  const usd = localAmount * rate;
  return Number.isFinite(usd) ? usd : null;
}
