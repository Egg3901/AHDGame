import type { Db } from "mongodb";
import {
  NPP_OPERATOR_TELEMETRY_SCHEMA_VERSION,
  aggregateNppOperatorObservations,
  type NppOperatorAggregate,
  type NppOperatorObservation,
} from "./rules";

export const NPP_OPERATOR_TELEMETRY_COLLECTION = "nppOperatorDiagnostics";
export const NPP_OPERATOR_TELEMETRY_RETENTION_TURNS = 48;

interface NppOperatorTelemetryDocument extends NppOperatorAggregate {
  _id: string;
  schemaVersion: typeof NPP_OPERATOR_TELEMETRY_SCHEMA_VERSION;
  turn: number;
  generatedAt: Date;
}

export async function recordNppOperatorObservationsBestEffort(
  db: Db,
  turn: number,
  now: Date,
  observations: readonly NppOperatorObservation[]
): Promise<void> {
  if (observations.length === 0) return;
  try {
    const collection = db.collection<NppOperatorTelemetryDocument>(
      NPP_OPERATOR_TELEMETRY_COLLECTION
    );
    await collection.updateOne(
      { _id: `turn:${turn}` },
      {
        $set: {
          schemaVersion: NPP_OPERATOR_TELEMETRY_SCHEMA_VERSION,
          turn,
          generatedAt: now,
          ...aggregateNppOperatorObservations(observations),
        },
      },
      { upsert: true }
    );
    await collection.deleteMany({
      turn: { $lt: Math.max(0, turn - NPP_OPERATOR_TELEMETRY_RETENTION_TURNS + 1) },
    });
  } catch (error) {
    console.warn("[npp-operator-telemetry] Failed to record observations", error);
  }
}
