/**
 * Per-country accessors over the preset seat groups.
 *
 * The grouping table itself lives in `historicalSeats.ts`, beside the arrays it
 * groups, so that file stays the single source and nothing imports back into it.
 * Only the logic lives here: `historicalSeats.ts` is size-cap exempt as a
 * pure-data file, and putting query helpers there would abuse that exemption.
 *
 * These exist because `HistoricalSeat` has no `countryId` and `officeType` is
 * not unique to a country. Asking "how many seats does the US Senate have in
 * 1991" by filtering on `officeType === "senate"` answers 181, because Brazil's
 * senate shares the key.
 */
import type { CountryId } from "./countries";
import { seatGroupsFor, type HistoricalSeat } from "./historicalSeats";

export { seatGroupsFor };

/** Every seat this preset gives this country, across all its offices. */
export function seatsForCountry(preset: string, countryId: CountryId): HistoricalSeat[] {
  return seatGroupsFor(preset)[countryId] ?? [];
}

/**
 * Seats this preset seats for one chamber, summing `seatsHeld`.
 *
 * A row is a per-region party bloc rather than an individual member: one row
 * carrying `seatsHeld: 45` is California's 45 Democratic representatives. So the
 * seat total is the sum of `seatsHeld`, and counting rows undercounts badly
 * (the 2020 US House is 83 rows and 435 seats).
 */
export function seatCountFor(preset: string, countryId: CountryId, chamberKey: string): number {
  return seatsForCountry(preset, countryId)
    .filter((seat) => seat.officeType === chamberKey)
    .reduce((total, seat) => total + (seat.seatsHeld ?? 1), 0);
}
