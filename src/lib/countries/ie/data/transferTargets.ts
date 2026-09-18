/**
 * Sub-national divisions shown when transferring from a national party treasury.
 * Centralized so UI and server validation can stay aligned per country.
 */

import { US_STATE_ID_NAME_PAIRS } from "@/lib/constants/usStateNames";
import { JP_REGIONS } from "@/lib/constants/japan";
import { UK_REGIONS } from "@/lib/constants/uk";
import { CN_MACRO_REGIONS } from "@/lib/constants/cn";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/** Ireland NUTS-III planning regions — id → display name. */
const IE_REGIONS: [string, string][] = [
  ["DUB", "Dublin"],
  ["KIL", "Kildare"],
  ["MID", "Midlands"],
  ["WEX", "Wexford"],
  ["LIM", "Limerick"],
  ["COR", "Cork"],
  ["GAL", "Galway"],
  ["DON", "Donegal"],
];

/** [id, displayName] tuples for the national-party → regional org transfer dropdown. */
export function getNationalPartyTransferTargets(countryId: CountryId): [string, string][] {
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return US_STATE_ID_NAME_PAIRS;
  }
  if (countryId === COUNTRY_CONFIGS.UK.id) {
    return UK_REGIONS.map((r) => [r.id, r.name]);
  }
  if (countryId === COUNTRY_CONFIGS.JP.id) {
    return JP_REGIONS.map((r) => [r.id, r.name]);
  }
  if (countryId === COUNTRY_CONFIGS.IE.id) {
    return IE_REGIONS;
  }
  if (countryId === COUNTRY_CONFIGS.CN.id) {
    return CN_MACRO_REGIONS;
  }
  return [];
}
