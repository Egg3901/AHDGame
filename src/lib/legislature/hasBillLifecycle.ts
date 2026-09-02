import type { CountryId } from "@/lib/constants/countries";
import { BILL_LIFECYCLE_COUNTRY_IDS } from "./billLifecycleCountries";

/**
 * Does this country's national bills get processed by an engine?
 *
 * 27 countries do: the 26 in `COUNTRY_BILL_PHASES`, PLUS the United States, whose
 * lifecycle is invoked directly from `billLifecycle.ts` and is therefore absent from
 * that table. A bare table lookup silently excludes the US — which is why this is a
 * named helper rather than an inline check.
 *
 * Used to gate spawning a mirrored bill: minting one for a country no engine walks
 * leaves a permanent `active_both` zombie on the floor, with nothing to close it and
 * nothing that reports it.
 *
 * Reads the id set rather than the operational table on purpose: the table binds a
 * runner per country, so importing it here would put the whole turn engine behind
 * every caller that merely wants to ask the question. The test beside
 * this file pins the set to the table, both ways, so they cannot drift.
 */
export function hasBillLifecycle(countryId: CountryId): boolean {
  return BILL_LIFECYCLE_COUNTRY_IDS.has(countryId);
}
