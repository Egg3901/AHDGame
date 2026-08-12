import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Does this country's national bills get processed by an engine?
 *
 * 17 countries do: the 16 in `COUNTRY_BILL_PHASES`, PLUS the United States, whose
 * lifecycle is invoked directly from `billLifecycle.ts` and is therefore absent from
 * that table. A bare table lookup silently excludes the US — which is why this is a
 * named helper rather than an inline check.
 *
 * Used to gate spawning a mirrored bill: minting one for a country no engine walks
 * leaves a permanent `active_both` zombie on the floor, with nothing to close it and
 * nothing that reports it.
 */
export function hasBillLifecycle(countryId: CountryId): boolean {
  return COUNTRY_BILL_PHASES[countryId] != null || countryId === COUNTRY_CONFIGS.US.id;
}
