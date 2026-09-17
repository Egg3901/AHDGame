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

export async function recordCapacityDecisionBestEffort(
  db: Db,
  turn: number,
  observation: CapacityDecisionObservation
): Promise<void> {
  try {
    const [key, values] = Object.entries(aggregateCapacityDecisions([observation]))[0];
    const increments = Object.fromEntries(
      Object.entries(values).map(([field, value]) => [`buckets.${key}.${field}`, value])
    );
    const collection = db.collection<CapacityDecisionFunnelDocument>(CAPACITY_DECISION_COLLECTION);
    await collection.updateOne(
      { _id: `turn:${turn}` },
      {
        $set: { schemaVersion: CAPACITY_DECISION_SCHEMA_VERSION, turn, updatedAt: new Date() },
        $inc: increments,
      },
      { upsert: true }
    );
    await collection.deleteMany({
      turn: { $lt: Math.max(0, turn - CAPACITY_DECISION_RETENTION_TURNS + 1) },
    });
  } catch (error) {
    console.warn("[capacity-decision-telemetry] Failed to record observation", error);
  }
}
