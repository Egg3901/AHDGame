import { getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";

/**
 * True when a country's president is elected on a ticket with a running mate
 * (Vice President). Drives whether the running-mate selector is offered on a
 * presidential race — a country qualifies iff it defines a `vicePresident`
 * office. Currently US, Brazil, and Nigeria; ceremonial presidencies without a
 * VP (Ireland's Uachtarán, China's President) do not.
 *
 * Accepts a plain string — election DTOs type `countryId` loosely — and safely
 * returns false for any unknown id (`getOfficeTypeConfig` is null-safe).
 */
export function countryHasPresidentialRunningMate(countryId: string): boolean {
  return getOfficeTypeConfig(countryId as CountryId, "vicePresident") !== undefined;
}
