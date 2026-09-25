import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import { makeEasternBlocBaselines } from "@/lib/seeds/shared/easternBlocMetrics";
import { SUCCESSOR_STATE_METRICS_1991 } from "@/lib/seeds/reference/successorMetrics1991";

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
    await db.collection("macroMetrics").deleteMany({ _id: { $in: ids } });
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
  log(`Seeded ${ids.length} January 1991 transition region metrics and baselines`);
}
