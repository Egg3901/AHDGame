/**
 * Seeded regions receive electorate leans before a reset opens the new world.
 * Missing caches are derived from live seeded demographics; valid existing
 * region leans are retained. Unsupported regions remain visibly unfilled.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { DemographicCategory, State, StateDemographics } from "@/lib/db/types";
import { calculateStateLean } from "@/lib/utils/demographics";

export async function backfillMissingRegionLeans(db: Db, now: Date) {
  const states = await db
    .collection<State>("states")
    .find(
      {},
      {
        projection: { countryId: 1, cachedEconomicLean: 1, cachedSocialLean: 1 },
      }
    )
    .toArray();
  const valid = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 5;
  const missing = states.filter(
    (row) => !valid(row.cachedEconomicLean) || !valid(row.cachedSocialLean)
  );
  if (!missing.length) return { written: 0, missingDemographics: 0, missingCategories: 0 };
  const demographics = await db
    .collection<StateDemographics>("stateDemographics")
    .find(
      { _id: { $in: missing.map((row) => row._id) } },
      { projection: { countryId: 1, categoryWeights: 1, groups: 1 } }
    )
    .toArray();
  const categories = await db
    .collection<DemographicCategory>("demographicCategories")
    .find(
      {},
      {
        projection: { groups: 1, defaultWeight: 1 },
      }
    )
    .toArray();
  const byRegion = new Map(demographics.map((row) => [row._id, row]));
  const stateOps: AnyBulkWriteOperation<State>[] = [],
    demoOps: AnyBulkWriteOperation<StateDemographics>[] = [];
  let missingDemographics = 0,
    missingCategories = 0;
  for (const state of missing) {
    const demo = byRegion.get(state._id);
    if (!demo || demo.countryId !== state.countryId || !demo.groups) {
      missingDemographics++;
      continue;
    }
    const supported = categories.some(
      (category) =>
        Number(demo.categoryWeights?.[category._id]) > 0 &&
        category.groups.some(
          (group) =>
            Number(demo.groups[group.id]?.population) > 0 &&
            Number(demo.groups[group.id]?.turnout ?? group.defaultTurnout ?? 55) > 0
        )
    );
    if (!supported) {
      missingCategories++;
      continue;
    }
    const lean = calculateStateLean(demo, categories);
    if (!valid(lean.economicLean) || !valid(lean.socialLean)) {
      missingCategories++;
      continue;
    }
    const caches = { cachedEconomicLean: lean.economicLean, cachedSocialLean: lean.socialLean };
    demoOps.push({
      updateOne: { filter: { _id: demo._id, countryId: demo.countryId }, update: { $set: caches } },
    });
    stateOps.push({
      updateOne: {
        filter: { _id: state._id, countryId: state.countryId },
        update: { $set: { ...caches, demographicsLastUpdated: now } },
      },
    });
  }
  if (stateOps.length) {
    // The states cache is the completion marker. Write it last so a retry after
    // a failed demographic-cache write still selects this region.
    await db
      .collection<StateDemographics>("stateDemographics")
      .bulkWrite(demoOps, { ordered: false });
    await db.collection<State>("states").bulkWrite(stateOps, { ordered: false });
  }
  return { written: stateOps.length, missingDemographics, missingCategories };
}
