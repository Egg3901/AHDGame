/**
 * Per-player, per-turn payout cap values.
 *
 * Kept separate from `payoutCap.ts` so client components can display the
 * limit without pulling the database-facing helpers into the browser
 * bundle. This module must stay free of any `mongodb` or `@/lib/db`
 * import, even a type-only one.
 *
 * A turn is one hour, and amounts are in each country's local currency,
 * which is why this is a per-country table rather than one constant: the
 * same number is a hard ceiling in one economy and no limit at all in
 * another.
 */

import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";

/** Maximum a single character may receive from party funds in one turn. */
export const PLAYER_PAYOUT_CAP_PER_TURN: Partial<Record<CountryId, number>> = {
  US: US_ECONOMY.payoutCapPerTurn,
  UK: UK_ECONOMY.payoutCapPerTurn,
  RU: RU_ECONOMY.payoutCapPerTurn,
  DD: DD_ECONOMY.payoutCapPerTurn,
  JP: JP_ECONOMY.payoutCapPerTurn,
};

/** Applied to any country not named above. */
export const DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN = 2_000_000;

/**
 * The per-turn payout cap in force for this country.
 *
 * The country id is normalised before lookup. A miss falls back to the
 * default silently, so a caller passing "uk" instead of "UK" would
 * otherwise display and enforce the wrong number with no error anywhere.
 */
export function getPlayerPayoutCap(countryId: CountryId | string): number {
  const key = String(countryId).toUpperCase() as CountryId;
  return PLAYER_PAYOUT_CAP_PER_TURN[key] ?? DEFAULT_PLAYER_PAYOUT_CAP_PER_TURN;
}

/**
 * The cap rendered for a player, in that country's own currency.
 *
 * The cap is a LOCAL-currency figure, so the symbol has to come from the
 * country rather than from a hardcoded "$". The Treasury tab's Request
 * Funds card already renders amounts through `CURRENCY_SYMBOLS`; the
 * refusal messages that quote the same number were printing dollars at
 * every country, telling a UK player their limit was $2,000,000.
 *
 * Normalises the country id for the same reason `getPlayerPayoutCap`
 * does: a lowercase code would otherwise fall through to the USD symbol
 * while the cap lookup fell through to the default value.
 */
export function formatPayoutCap(countryId: CountryId | string, amount: number): string {
  const key = String(countryId).toUpperCase() as CountryId;
  const symbol = CURRENCY_SYMBOLS[COUNTRY_CURRENCY_MAP[key]] ?? "$";
  return `${symbol}${amount.toLocaleString()}`;
}
