// src/lib/constants/characterWealth.ts
import type { CountryId } from "./countries";
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES, type CurrencyCode } from "./currencies";
import { formatLocalAmountFull } from "@/lib/utils/formatters";
import { getEraNominalAmount } from "./sectorSeedEra";

/** Wealth-background tiers a player picks at character creation. */
export type WealthLevel = "low" | "middle" | "high";

/**
 * Personal starting cash by wealth background, in internal anchor units (₳),
 * which are pegged 1:1 to USD (the US initial FX rate is 1.0).
 *
 * Single source of truth shared by the character-creation route (which credits
 * the balance) and the registration UI (which previews it), so the displayed
 * figure can never drift from the amount actually granted.
 */
export const WEALTH_BONUS: Record<WealthLevel, number> = {
  low: 1_000_000,
  middle: 2_500_000,
  high: 5_000_000,
};

/**
 * Starting cash for a wealth background, in the era's own money.
 *
 * Unscaled, a 1953 "Low Income" character receives 1,000,000 — roughly 250x
 * that era's median family income, when a house cost about 9,000. Every other
 * nominal quantity in a 1953 world is deflated, so leaving this modern made
 * every new character absurdly rich relative to the economy.
 *
 * MUST move together with the corporation founding cost. Deflating starting
 * cash alone makes founding impossible in 1953: the fee plus the minimum
 * capital commitment would exceed even a high-income character's whole balance.
 *
 * PURE on purpose — the registration page previews this and the API route
 * grants it, and the two must agree or the preview lies.
 */
export function getWealthBonus(level: WealthLevel, preset?: string): number {
  const base = WEALTH_BONUS[level] ?? 0;
  if (base <= 0) return 0;
  return getEraNominalAmount(base, preset);
}

/** Display order + human label for each tier. */
export const WEALTH_LEVELS: { value: WealthLevel; label: string }[] = [
  { value: "low", label: "Low Income" },
  { value: "middle", label: "Middle Income" },
  { value: "high", label: "High Income" },
];

/**
 * Resolve the home currency + initial FX rate for a country code (any casing).
 * Mirrors the conversion the character-creation route applies at insert time,
 * so previews equal what the player actually receives. Unknown/empty codes fall
 * back to USD at parity (rate 1.0).
 */
export function resolveStartingCurrency(countryIdRaw?: string | null): {
  currencyCode: CurrencyCode;
  rate: number;
} {
  const countryId = (countryIdRaw ?? "").toUpperCase() as CountryId;
  return {
    currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
    rate: INITIAL_RATES[countryId] ?? 1.0,
  };
}

/**
 * Convert an anchor-denominated starting amount to a country's home currency.
 * Uses INITIAL_RATES (not live DB rates) so all players created at the same
 * tier receive an identical local-currency endowment.
 */
export function convertStartingAnchorToLocal(
  anchorAmount: number,
  countryIdRaw?: string | null
): number {
  const { rate } = resolveStartingCurrency(countryIdRaw);
  return Math.round(anchorAmount * rate);
}

/**
 * Build the wealth-tier dropdown options for the given country, with each
 * amount converted into the country's home currency and labelled with its
 * symbol. Defaults to the USD-equivalent display when no country is selected.
 */
export function buildWealthOptions(
  countryIdRaw?: string | null
): { value: WealthLevel; label: string }[] {
  const { currencyCode, rate } = resolveStartingCurrency(countryIdRaw);
  return WEALTH_LEVELS.map(({ value, label }) => ({
    value,
    label: `${label} - ${formatLocalAmountFull(Math.round(WEALTH_BONUS[value] * rate), currencyCode)}`,
  }));
}
