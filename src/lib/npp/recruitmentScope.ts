/**
 * Recruitment capacity counts active NPPs in one country and party.
 * Legacy NPPs without a country belong to the US, matching election entry.
 * activePartyNppFilter optionally restricts the count to one home region.
 */
import type { Filter } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

export function activePartyNppFilter(
  countryId: CountryId,
  party: string,
  homeState?: string
): Filter<NPP> {
  return {
    ...(countryId === COUNTRY_CONFIGS.US.id
      ? { $or: [{ countryId }, { countryId: { $exists: false } }] }
      : { countryId }),
    party,
    retiredAt: null,
    ...(homeState === undefined ? {} : { homeState }),
  };
}
