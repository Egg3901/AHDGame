import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

/**
 * Derived-model equivalent of "auto-dissolution": for any corp formalized as a
 * subsidiary, if no corporation controls >50% voting power anymore, clear the
 * formalization marker + dividend-floor fields (prevents zombie subsidiaries).
 * Also clears a stale dividend floor whose setter no longer controls >50%.
 *
 * Cheap and gated — callers only invoke when the feature flag is on.
 * Returns the number of corporations updated.
 */
export async function cleanupZombieSubsidiaries(
  db: Db,
  corps: Corporation[],
  now: Date
): Promise<number> {
  const ops: AnyBulkWriteOperation<Corporation>[] = [];
  for (const corp of corps) {
    const isFormalized = corp.subsidiaryFormalizedAtTurn != null;
    const hasFloor = corp.parentDividendFloorSetByCorpId != null;
    if (!isFormalized && !hasFloor) continue;

    const controller = getControllingCorporateParent(corp);

    if (isFormalized && !controller) {
      // Nobody controls >50% — dissolve the managed relationship entirely.
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: {
            $unset: {
              subsidiaryFormalizedAtTurn: "",
              parentDividendFloorPct: "",
              parentDividendFloorSetByCorpId: "",
            },
            $set: { updatedAt: now },
          },
        },
      });
      continue;
    }

    // Formalization still valid (someone controls); clear only a stale floor
    // whose setter is no longer the controlling parent.
    if (
      hasFloor &&
      (!controller || !controller.corporationId.equals(corp.parentDividendFloorSetByCorpId!))
    ) {
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: {
            $unset: { parentDividendFloorPct: "", parentDividendFloorSetByCorpId: "" },
            $set: { updatedAt: now },
          },
        },
      });
    }
  }

  if (ops.length === 0) return 0;
  await db.collection<Corporation>("corporations").bulkWrite(ops);
  return ops.length;
}
