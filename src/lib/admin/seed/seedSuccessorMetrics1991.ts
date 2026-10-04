import type { Db, Filter } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import { makeEasternBlocBaselines } from "@/lib/seeds/shared/easternBlocMetrics";
import { SUCCESSOR_STATE_METRICS_1991 } from "@/lib/seeds/reference/successorMetrics1991";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";

/** Obsolete regional rows left by earlier seed passes, excluding national summaries. */
export function obsoleteSuccessorMetricFilter1991(): Filter<MacroMetricsDoc> {
  return {
    countryId: {
      $in: [
        ...new Set(SUCCESSOR_STATE_METRICS_1991.flatMap((m) => (m.countryId ? [m.countryId] : []))),
      ],
    },
    _id: { $nin: [...SUCCESSOR_STATE_METRICS_1991.map((m) => m._id), ...NATIONAL_SCOPE_IDS] },
  };
}

/** Persist the authored transition metric vectors and their decay targets. */
export async function seedSuccessorMetrics1991(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  const ids = SUCCESSOR_STATE_METRICS_1991.map((metric) => metric._id);
  if (reset) {
    await db.collection<MacroMetricsDoc>("macroMetrics").deleteMany({ _id: { $in: ids } });
    await db.collection<StateMetrics>("stateMetrics").deleteMany({ _id: { $in: ids } });
    await db.collection<StateMetricBaseline>("stateBaselines").deleteMany({ _id: { $in: ids } });
  }
  await writeSplitMetricsBulk(db, SUCCESSOR_STATE_METRICS_1991);
  const baselines = makeEasternBlocBaselines(SUCCESSOR_STATE_METRICS_1991);
  await db.collection<StateMetricBaseline>("stateBaselines").bulkWrite(
    baselines.map(({ _id, ...baseline }) => ({
      updateOne: { filter: { _id }, update: { $set: baseline }, upsert: true },
    }))
  );
  // Earlier packs can seed older aggregate ids (HU_HUN, PL_CEN, UKR, etc.).
  // Upserting the detailed 1991 vectors does not retire those extra rows.
  // Purge only after the complete replacement vectors have been persisted.
  const removed = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .deleteMany(obsoleteSuccessorMetricFilter1991());
  if (removed.deletedCount > 0) {
    log(`Removed ${removed.deletedCount} obsolete January 1991 regional macro rows`);
  }
  log(`Seeded ${ids.length} January 1991 transition region metrics and baselines`);
}
