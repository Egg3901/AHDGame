import { MARKETIZATION_SCHEDULE } from "@/lib/constants/commandEconomy";
import { FOREX_ACTIVE_CURRENCIES, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/** Subset of `/api/countries` fields used to bucket forex rows. */
export type ForexCountryAccess = {
  enabledForPlayers: boolean;
  economyPreview: boolean;
  econOnly?: boolean;
};

export type ForexRateCountry = {
  countryId: CountryId;
  currencyCode: CurrencyCode;
};

/**
 * Planned / command-schedule countries (Eastern bloc, USSR, Maoist China, …).
 * Used only for display ordering — not a trading gate.
 */
export function isPlannedEconomyCountry(countryId: CountryId): boolean {
  return Object.prototype.hasOwnProperty.call(MARKETIZATION_SCHEDULE, countryId);
}

/** Market / westernized economies for forex UI ordering. */
export function isWesternizedCountry(countryId: CountryId): boolean {
  return !isPlannedEconomyCountry(countryId);
}

function forexListIndex(code: CurrencyCode): number {
  const idx = FOREX_ACTIVE_CURRENCIES.indexOf(code);
  return idx === -1 ? FOREX_ACTIVE_CURRENCIES.length : idx;
}

/**
 * Sort key for non-player currencies:
 * 0 — westernized + econ-only (economy preview / read-only market nations)
 * 1 — other westernized
 * 2 — planned / command-schedule econ-only
 * 3 — remaining planned
 */
function otherSortRank(countryId: CountryId, access: ForexCountryAccess | undefined): number {
  const westernized = isWesternizedCountry(countryId);
  const econOnly =
    access?.econOnly === true ||
    access?.economyPreview === true ||
    (access != null && !access.enabledForPlayers);

  if (westernized && econOnly) return 0;
  if (westernized) return 1;
  if (econOnly) return 2;
  return 3;
}

function compareOtherRates<T extends ForexRateCountry>(
  a: T,
  b: T,
  accessByCountry: Partial<Record<CountryId, ForexCountryAccess>>
): number {
  const rankA = otherSortRank(a.countryId, accessByCountry[a.countryId]);
  const rankB = otherSortRank(b.countryId, accessByCountry[b.countryId]);
  if (rankA !== rankB) return rankA - rankB;
  const idx = forexListIndex(a.currencyCode) - forexListIndex(b.currencyCode);
  if (idx !== 0) return idx;
  return a.currencyCode.localeCompare(b.currencyCode);
}

/**
 * Split forex rates into player-enabled primary rows and a secondary list
 * (westernized econ-only first). When no access map is available, all rates
 * stay in `player` so the page never blanks out.
 */
export function partitionForexRates<T extends ForexRateCountry>(
  rates: T[],
  accessByCountry: Partial<Record<CountryId, ForexCountryAccess>> | null | undefined
): { player: T[]; other: T[] } {
  if (!accessByCountry || Object.keys(accessByCountry).length === 0) {
    return { player: [...rates], other: [] };
  }

  const player: T[] = [];
  const other: T[] = [];

  for (const rate of rates) {
    const access = accessByCountry[rate.countryId];
    if (access?.enabledForPlayers) {
      player.push(rate);
    } else {
      other.push(rate);
    }
  }

  // Access map present but no player match (stale/mis-seeded) — show everything.
  if (player.length === 0 && other.length > 0) {
    return { player: [...rates], other: [] };
  }

  other.sort((a, b) => compareOtherRates(a, b, accessByCountry));

  player.sort(
    (a, b) =>
      forexListIndex(a.currencyCode) - forexListIndex(b.currencyCode) ||
      a.currencyCode.localeCompare(b.currencyCode)
  );

  return { player, other };
}

/** Currency codes for the player-enabled partition (chart defaults). */
export function playerCurrencyCodes(
  rates: ForexRateCountry[],
  accessByCountry: Partial<Record<CountryId, ForexCountryAccess>> | null | undefined
): CurrencyCode[] {
  return partitionForexRates(rates, accessByCountry).player.map((r) => r.currencyCode);
}

/** Country ids for the player-enabled partition (macro chart defaults). */
export function playerCountryIds(
  rates: ForexRateCountry[],
  accessByCountry: Partial<Record<CountryId, ForexCountryAccess>> | null | undefined
): CountryId[] {
  return partitionForexRates(rates, accessByCountry).player.map((r) => r.countryId);
}
