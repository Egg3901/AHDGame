import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CongressionalDistrict } from "@/lib/db/types";
import { buildDistrictDocsForStates } from "./buildStateDocs";

/**
 * Rebuild the district maps of the given states neutrally (from current
 * registration). Deletes their existing docs first so seat-count reductions
 * drop orphan indices. Regenerated docs keep `lastRedrawnCensus = null`, so a
 * legislature-drawn trifecta can still redraw this census.
 */
export async function regenerateCongressionalDistricts(
  db: Db,
  opts: { countryId: CountryId; stateIds: string[]; now: Date }
): Promise<{ regenerated: number }> {
  if (opts.stateIds.length === 0) return { regenerated: 0 };

  const coll = db.collection<CongressionalDistrict>("congressionalDistricts");
  await coll.deleteMany({
    countryId: opts.countryId,
    stateId: { $in: opts.stateIds },
  });

  const docs = await buildDistrictDocsForStates(db, opts.countryId, opts.now, opts.stateIds);
  for (const doc of docs) {
    // Upsert by the deterministic `_id` (`${countryId}_${stateId}_${index}`)
    // rather than insert: if the delete missed a stale row, or a concurrent
    // trigger recreated one, this overwrites it instead of throwing a duplicate
    // -key error on the unique (countryId, stateId, index) index — which would
    // otherwise surface as an opaque 500.
    await coll.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  }
  return { regenerated: docs.length };
}
