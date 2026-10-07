import type { Db } from "mongodb";

/**
 * Reference collections a reset empties before a reference rebuild
 * (`resetReference: true`), so the bootstrap that follows writes them into an
 * empty collection exactly as it does on a brand-new database.
 *
 * Each one is manifest category `reference`, which the teardown's runtime sweep
 * never touches, and each is seeded by upserts keyed on the NEW roster. An
 * upsert cannot remove a row the new world does not write, so without this
 * clear a reset kept every row the outgoing world had and the fresh seed would
 * not: measured on a 1991 reset of an existing world, Ukrainian, Belarusian and
 * Baltic region baselines and turnout rows, Soviet and East German registration
 * pools, retired voter-group categories, East German strategic sectors and
 * metrics, and cohort rows for regions the 1991 seed gives no age profile. Most
 * also carry turn-by-turn runtime state (registration drift, turnout decay,
 * consumed market headroom, cohort ageing, head-of-government designations).
 *
 * Every entry must be rebuilt by `bootstrapGameWorld` for every preset that
 * seeds it, and must hold nothing that outlives a world. Enforced by
 * referenceRebuildClear.test.ts against the seed manifest.
 */
export const REFERENCE_REBUILD_CLEARED_COLLECTIONS: ReadonlyArray<{
  name: string;
  seededBy: string;
}> = [
  { name: "unownedSectors", seededBy: "seedUnownedSectors" },
  { name: "stateBaselines", seededBy: "runCoreSeed and the country seeders" },
  { name: "stateDemographicTurnout", seededBy: "runCoreSeed and the country seeders" },
  { name: "stateRegistrationPool", seededBy: "seedRegistrationLanes" },
  { name: "regionDemographics", seededBy: "seedCohortVectors" },
  { name: "strategicSectorDesignations", seededBy: "seedStrategicSectors" },
  { name: "stateMetrics", seededBy: "seedRegionMetrics (retired store, cleared for stragglers)" },
  { name: "demographicCategories", seededBy: "runCoreSeed and the country seeders" },
];

/** Empty every collection in {@link REFERENCE_REBUILD_CLEARED_COLLECTIONS}. */
export async function clearReferenceForRebuild(db: Db): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const { name } of REFERENCE_REBUILD_CLEARED_COLLECTIONS) {
    const result = await db.collection(name).deleteMany({});
    deleted[name] = result.deletedCount ?? 0;
  }
  return deleted;
}
