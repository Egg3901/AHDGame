import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isShippingPreset, tierFor } from "@/lib/world/eraRoster";

/**
 * Country-keyed region collections a preset switch can strand.
 *
 * Only the US pack clears these on reset (`RESET_DROP_COLLECTIONS`); every other
 * country's seeder upserts its own rows. A country the new preset does not seed
 * therefore keeps the outgoing world's rows: a 1953 world reset to 1991 kept
 * Ukraine, Byelorussia and the Baltic republics as separate `states` rows with
 * 1953 demographics, alongside the same republics modelled as Soviet regions.
 *
 * Parties are left to the default-party reconciliation, which owns them.
 */
export const ABSENT_COUNTRY_REGION_COLLECTIONS = [
  "states",
  "stateDemographics",
  "demographicDefaults",
  "statePartyOrg",
  "politicalMetrics",
  "macroMetrics",
  "federalBudget",
  "stateBudgets",
  "stateResourceCapacity",
  "congressionalDistricts",
  "stateSectorSpecializations",
] as const;

/** Countries the era roster says are not present in this preset at all. */
export function absentCountryIds(preset: string): CountryId[] {
  if (!isShippingPreset(preset)) return [];
  return (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
    (id) => tierFor(preset, id) === "absent"
  );
}

/**
 * Delete region rows that belong to countries absent from `preset`. Runs after
 * every seeder, so a country the preset seeds is never affected: the roster is
 * the same source the bootstrap packs gate on.
 */
export async function purgeAbsentCountryRegions(
  db: Db,
  preset: string
): Promise<{ countryIds: CountryId[]; deleted: Record<string, number> }> {
  const countryIds = absentCountryIds(preset);
  const deleted: Record<string, number> = {};
  if (countryIds.length === 0) return { countryIds, deleted };
  for (const name of ABSENT_COUNTRY_REGION_COLLECTIONS) {
    const result = await db.collection(name).deleteMany({ countryId: { $in: countryIds } });
    if (result.deletedCount > 0) deleted[name] = result.deletedCount;
  }
  return { countryIds, deleted };
}
