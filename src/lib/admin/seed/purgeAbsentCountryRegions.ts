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
 * The party rows go too. The default-party reconciliation only removes parties
 * whose seed entry is preset-mismatched, so a Ukrainian or East German default
 * party from an older world survived a 1991 reset, and `seedPartyBudgets`
 * re-funded it. The reset runs a reference rebuild for 1991 (see
 * REFERENCE_REBUILD_CLEARED_COLLECTIONS), which empties several of the
 * collections below first; listing them here also covers a preserve-reference
 * reset of another preset.
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
  "stateDemographicTurnout",
  "stateRegistrationPool",
  "regionDemographics",
  "stateMetrics",
  "strategicSectorDesignations",
  "politicalParties",
  "partyBudget",
  "partyCharters",
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
  if (!isShippingPreset(preset)) return { countryIds, deleted };
  if (countryIds.length > 0) {
    for (const name of ABSENT_COUNTRY_REGION_COLLECTIONS) {
      const result = await db.collection(name).deleteMany({ countryId: { $in: countryIds } });
      if (result.deletedCount > 0) deleted[name] = result.deletedCount;
    }
    // Party sequence counters for those countries; a fresh world has none.
    const counters = await db
      .collection<{ _id: string }>("counters")
      .deleteMany({ _id: { $in: countryIds.map((id) => `party_${id}`) } });
    if (counters.deletedCount > 0) deleted.counters = counters.deletedCount;
  }

  // `politicalMetrics` is keyed by region id, and some retired RU rows have a
  // still-present countryId even though their regions are no longer seeded.
  // Use the completed states roster as the authority. Keep the non-empty guard
  // so a partial bootstrap cannot erase the entire board.
  const stateIds = (
    await db.collection<{ _id: string }>("states").find({}).project({ _id: 1 }).toArray()
  ).map((state) => state._id);
  if (stateIds.length > 0) {
    const result = await db.collection("politicalMetrics").deleteMany({ _id: { $nin: stateIds } });
    if (result.deletedCount > 0) {
      deleted.politicalMetrics = (deleted.politicalMetrics ?? 0) + result.deletedCount;
    }
  }
  return { countryIds, deleted };
}
