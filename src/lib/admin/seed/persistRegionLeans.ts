import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { DemographicCategory, State, StateDemographics } from "@/lib/db/types";
import { calculateStateLean } from "@/lib/utils/demographics";

/**
 * Derive each region's electorate lean from its seeded demographics and write it
 * onto the `states` document.
 *
 * Seeding `stateDemographics` alone is not enough: `cachedEconomicLean` /
 * `cachedSocialLean` are what `getStateLean` reads, what the region pickers
 * display, and — via policy distance — what the election engine weighs. A
 * country that seeds demographics but skips this step contributes nothing to
 * that calculation and renders as "lean not yet derived" (#3752, which is
 * exactly what RU and DD did).
 *
 * Returns the number of regions written.
 */
export async function persistRegionLeans(
  db: Db,
  regionDemographics: StateDemographics[],
  categories: DemographicCategory[]
): Promise<number> {
  if (regionDemographics.length === 0 || categories.length === 0) return 0;

  const now = new Date();
  const ops: AnyBulkWriteOperation<State>[] = regionDemographics.map((sd) => {
    const lean = calculateStateLean(sd, categories);
    return {
      updateOne: {
        filter: { _id: sd._id },
        update: {
          $set: {
            cachedEconomicLean: lean.economicLean,
            cachedSocialLean: lean.socialLean,
            demographicsLastUpdated: now,
          },
        },
      },
    };
  });

  await db.collection<State>("states").bulkWrite(ops, { ordered: false });
  return ops.length;
}
