import type { Db } from "mongodb";
import {
  CAPACITY_DECISION_SCHEMA_VERSION,
  aggregateCapacityDecisions,
  type CapacityDecisionObservation,
} from "./rules";

export const CAPACITY_DECISION_COLLECTION = "capacityDecisionFunnels";
export const CAPACITY_DECISION_RETENTION_TURNS = 48;

interface CapacityDecisionFunnelDocument {
  _id: string;
  schemaVersion: typeof CAPACITY_DECISION_SCHEMA_VERSION;
  turn: number;
  updatedAt: Date;
  buckets: Record<string, unknown>;
}

function incrementsFor(
  key: string,
  values: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [`buckets.${key}.${field}`, value])
  );
}

export async function recordCapacityDecisionBestEffort(
  db: Db,
  turn: number,
  observation: CapacityDecisionObservation
): Promise<void> {
  await recordCapacityDecisionBulkBestEffort(db, turn, [observation]);
}

/**
 * Turn-path flush: observations are aggregated in memory first, then applied
 * in ONE bulkWrite (one round trip no matter how many corporations decided),
 * so the NPP cohort adds no per-row turn queries and no new reads at all. The
 * bucket key is a closed vocabulary (actor × cohort × stage × outcome), so the
 * per-turn document holds a bounded number of keys; documents older than the
 * retention window are deleted on every flush.
 */
export async function recordCapacityDecisionBulkBestEffort(
  db: Db,
  turn: number,
  observations: readonly CapacityDecisionObservation[]
): Promise<void> {
  if (observations.length === 0) return;
  try {
    const buckets = aggregateCapacityDecisions(observations);
    const collection = db.collection<CapacityDecisionFunnelDocument>(CAPACITY_DECISION_COLLECTION);
    await collection.bulkWrite(
      Object.entries(buckets).map(([key, values]) => ({
        updateOne: {
          filter: { _id: `turn:${turn}` },
          update: {
            $set: { schemaVersion: CAPACITY_DECISION_SCHEMA_VERSION, turn, updatedAt: new Date() },
            $inc: incrementsFor(key, values as unknown as Record<string, number>),
          },
          upsert: true,
        },
      }))
    );
    await collection.deleteMany({
      turn: { $lt: Math.max(0, turn - CAPACITY_DECISION_RETENTION_TURNS + 1) },
    });
  } catch (error) {
    console.warn("[capacity-decision-telemetry] Failed to record observations", error);
  }
}
