import type { Db } from "mongodb";

const CONFIDENCE_START = 100;

/** Reset the gauge to full when a new UK government forms. */
export async function resetConfidenceGauge(db: Db, now: Date): Promise<void> {
  await db.collection<{ _id: string }>("ukGovernment").updateOne(
    { _id: "current" },
    {
      $set: { confidenceGauge: CONFIDENCE_START, confidenceGaugeUpdatedAt: now, updatedAt: now },
    },
    { upsert: true }
  );
}
