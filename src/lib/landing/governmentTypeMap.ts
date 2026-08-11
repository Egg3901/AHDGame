import { COUNTRY_CONFIGS, type GovernmentType } from "@/lib/constants/countries";
import type { CountryState } from "@/lib/db/types/countryState";

/**
 * Build a countryId → governmentType map for the marketing landing.
 * Seeds from COUNTRY_CONFIGS, then overlays live `countryState.governmentType`
 * so mid-game system conversions (Stage-4 collapse, convention ratification)
 * are reflected without a hand-maintained marketing tag.
 */
export function buildGovernmentTypeMap(
  liveDocs: Pick<CountryState, "_id" | "governmentType">[] = []
): Record<string, GovernmentType> {
  const map: Record<string, GovernmentType> = {};
  for (const [id, config] of Object.entries(COUNTRY_CONFIGS)) {
    map[id] = config.governmentType;
  }
  for (const doc of liveDocs) {
    if (doc._id && doc.governmentType) {
      map[doc._id] = doc.governmentType;
    }
  }
  return map;
}
