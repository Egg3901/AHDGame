import type { Db } from "mongodb";
import { CONFIDENCE_START } from "@/lib/uk/confidence/confidenceGauge";
import { getUKGovernmentCollection } from "@/lib/db/collections/ukGovernment";

/** Reset the gauge to full when a new UK government forms. */
export async function resetConfidenceGauge(db: Db, now: Date): Promise<void> {
  await getUKGovernmentCollection(db).updateOne(
    { _id: "current" },
    { $set: { confidenceGauge: CONFIDENCE_START, confidenceGaugeUpdatedAt: now, updatedAt: now } },
    { upsert: true }
  );
}
