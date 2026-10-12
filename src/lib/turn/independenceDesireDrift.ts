/**
 * Independence and Reunification Desire advances once per turn for UK devolved regions.
 * processIndependenceDesireDrift loads shared previews and writes actual movement in one batch.
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { IndependenceDesireDriftResult } from "@/lib/governorOffice/devolution/rules";
import { loadIndependenceDesireSnapshots } from "@/lib/governorOffice/devolution/queries";
export * from "@/lib/governorOffice/devolution/rules";
export {
  computeIndependenceDesireDriftForRegion,
  loadIndependenceDesireSnapshots,
} from "@/lib/governorOffice/devolution/queries";

export async function processIndependenceDesireDrift(
  db: Db,
  _currentTurn: number
): Promise<IndependenceDesireDriftResult | null> {
  const perRegion = await loadIndependenceDesireSnapshots(db);
  if (perRegion.length === 0) return null;
  const now = new Date();
  const writes = perRegion.map(({ stateId, previous, next, delta }) => ({
    updateOne: {
      filter: {
        _id: stateId,
        $or: [
          { "independenceDesire.value": previous },
          { "independenceDesire.value": { $exists: false } },
        ],
      },
      update: { $set: { independenceDesire: { value: next, trend: delta }, lastUpdated: now } },
    },
  }));
  // A PM decision or referendum count may have changed Desire since the read.
  // Leave that newer value intact; the next turn computes a fresh drift.
  const result = await db.collection<MacroMetricsDoc>("macroMetrics").bulkWrite(writes);
  return { regionsProcessed: result.matchedCount, perRegion };
}
