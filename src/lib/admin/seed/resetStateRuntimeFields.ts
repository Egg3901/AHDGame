import type { Db } from "mongodb";

/** Fields that hold engine, campaign, cache, or legacy state rather than the region baseline. */
export const STATE_RUNTIME_UNSET_FIELDS = [
  "votingEligiblePopulation",
  "workingAgePopulation",
  "militaryServicePopulation",
  "capitalStock",
  "conflictCapacityApplied",
  "outputGap",
  // Half-hour tick stamps and start values (turn/subhour): turn-scoped.
  "subhourStep",
  "subhourBase",
  "sectorRealizedRevenue",
  "sectorRealizedRevenueTurn",
  "sectorRealizedRevenueUnit",
  "sectorRevenueEma",
  "sectorRevenueSnapshots",
  "sectorOutputEma",
  "sectorOutputSnapshots",
  "corpGrowthInvestmentAnchor",
  "corpGrowthInvestmentTurn",
  "topSectorsCache",
  "sectorSpecializations",
  "admittedYear",
  "votingSystem",
  "politicalLean",
  "cachedEconomicLean",
  "cachedSocialLean",
  "demographicsLastUpdated",
] as const;

/**
 * Schema fields intentionally left in place while the reset is sealed.
 * Keep each reason specific; the schema contract test rejects unlisted fields.
 */
export const STATE_PRESERVED_FIELD_REASONS: Readonly<Record<string, string>> = {
  _id: "Stable region identity used by the authored bundles and region references.",
  countryId: "Authored country ownership used to scope reset and bootstrap seeders.",
  regionType: "Authored geographic level: state, nation, province, or region.",
  parentRegionId: "Authored parent-child geography for provinces and subregions.",
  name: "Authored display name for the region.",
  population:
    "Authored starting population; country seeders overwrite it from the target era bundle.",
  gdp: "Authored starting GDP; bootstrap overwrites and reconciles it for the target era.",
  houseDistricts: "Authored lower-chamber apportionment baseline.",
  stateSenateSeats: "Authored regional chamber apportionment baseline.",
  region: "Authored geographic grouping used by regional rules and displays.",
  bannerImage: "Authored static region artwork reference.",
};

/** Clear world-specific state before reference region rows are upserted. */
export async function resetStateRuntimeFields(db: Db): Promise<number> {
  const result = await db
    .collection("states")
    .updateMany(
      {},
      { $unset: Object.fromEntries(STATE_RUNTIME_UNSET_FIELDS.map((field) => [field, ""])) }
    );
  return result.modifiedCount ?? 0;
}
