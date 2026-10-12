/**
 * Expand a single live UK nation-region (`"SCO"` / `"WAL"`) into its full set of
 * standalone-country sub-regions when it secedes:
 *
 *   1. Insert the SP1 seed `State[]` for the country (`scoRegions`/`walRegions`).
 *   2. Fan the aggregate's dynamic per-region data out across the sub-regions
 *      (metrics/demographics/budgets/sectors/registration/residents/devolved
 *      artifacts), per the declarative `SECEDE_FANOUT` policy table.
 *   3. Delete the old single `"SCO"`/`"WAL"` `states` aggregate.
 *
 * Idempotent — re-firing on an already-expanded region is a no-op (the capital
 * sub-region already present). The fan-out step is added in subsequent tasks.
 */
import type { ConflictCapacityObligation } from "@/lib/db/types/conflictCapacity";
import type { Db } from "mongodb";
import type { State, GameState } from "@/lib/db/types";
import { SUB_REGION_SEEDS, CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";
import { expandLiveRegions } from "./rules/liveRegions";
import { SECEDE_FANOUT, type FanoutPolicy } from "./fanoutPolicy";
import { applyFanout, buildFanoutContext } from "./fanoutDriver";

export interface ExpandToSubRegionsResult {
  inserted: number;
  skipped?: "already-expanded";
  fannedOut: Array<{ collection: string; policy: FanoutPolicy; writes: number }>;
}

export async function expandToSubRegions(
  db: Db,
  countryId: SecedingCountryId
): Promise<ExpandToSubRegionsResult> {
  const seeds = SUB_REGION_SEEDS[countryId];
  const capital = CAPITAL_SUBREGION[countryId];

  // Idempotency: if the capital sub-region already exists, the region was expanded.
  const already = await db.collection<State>("states").findOne({ _id: capital });
  if (already) return { inserted: 0, skipped: "already-expanded", fannedOut: [] };

  const aggregate = await db.collection<State>("states").findOne({ _id: countryId });
  if (!aggregate) throw new Error(`${countryId} live aggregate is missing`);
  const liveRegions = expandLiveRegions(aggregate, seeds);
  const now = new Date();
  await db
    .collection<State>("states")
    .insertMany(liveRegions.map((s) => ({ ...s, countryId, updatedAt: now }) as State));

  // Fan the aggregate's dynamic per-region data out across the sub-regions.
  // The reset preset selects the era demographic pattern (1991 vs 2019).
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const ctx = buildFanoutContext(countryId, seeds, gameState?.preset);
  const fannedOut: ExpandToSubRegionsResult["fannedOut"] = [];
  for (const scope of SECEDE_FANOUT) {
    const writes = await applyFanout(db, scope, ctx);
    fannedOut.push({ collection: scope.collection, policy: scope.policy, writes });
  }

  // Repair obligations and their applied amounts must retain the same identity.
  const obligations = await db
    .collection<ConflictCapacityObligation>("conflictCapacityObligations")
    .find({ regionId: countryId })
    .toArray();
  if (obligations.length) {
    const weights = buildFanoutContext(countryId, seeds).gdpWeights;
    await db.collection<ConflictCapacityObligation>("conflictCapacityObligations").insertMany(
      obligations.flatMap((obligation) =>
        liveRegions.map((region) => ({
          ...obligation,
          _id: `${obligation._id}:${region._id}`,
          regionId: region._id,
          regionName: region.name,
          capitalStockBefore: obligation.capitalStockBefore * weights[region._id],
          destroyedCapital: obligation.destroyedCapital * weights[region._id],
        }))
      )
    );
    await db
      .collection<ConflictCapacityObligation>("conflictCapacityObligations")
      .deleteMany({ regionId: countryId });
  }
  await db
    .collection("npps")
    .updateMany({ homeState: countryId }, { $set: { homeState: capital, countryId } });
  await db
    .collection("corporations")
    .updateMany(
      { headquartersState: countryId },
      { $set: { headquartersState: capital, countryId } }
    );

  // Drop the single-region aggregate once its sub-regions exist.
  await db.collection<State>("states").deleteOne({ _id: countryId });

  return { inserted: seeds.length, fannedOut };
}
