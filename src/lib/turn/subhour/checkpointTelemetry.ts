import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type CheckpointKind = "markets" | "half-hour";
export type CheckpointOutcome = "running" | "clean" | "degraded" | "aborted" | "skipped";
interface TickResult {
  turn: number;
  ms: number;
  corpsRepriced?: number;
  electionTurn?: number | null;
  steps?: Record<string, object>;
  market?: { corpsRepriced: number } | null;
}
export interface CheckpointRun {
  _id: string;
  kind: CheckpointKind;
  slotAt: Date;
  startedAt: Date;
  completedAt?: Date;
  state: CheckpointOutcome;
  durationMs?: number;
  turn?: number;
  failures?: string[];
  corpsRepriced?: number;
}
const initialized = new WeakSet<Db>();

/** Best-effort telemetry must never suppress or retry a gameplay write. */
export async function trackCheckpoint<T extends TickResult>(
  kind: CheckpointKind,
  run: () => Promise<T | null>,
  db?: Db,
  now = new Date()
): Promise<T | null> {
  const started = Date.now();
  const record: CheckpointRun = {
    _id: randomUUID(),
    kind,
    slotAt: new Date(Math.floor(now.getTime() / 900_000) * 900_000),
    startedAt: now,
    state: "running",
  };
  let database: Db | undefined;
  let recorded = false;
  try {
    database = db ?? (await getDb());
    const collection = database.collection<CheckpointRun>("checkpointRuns");
    if (!initialized.has(database)) {
      await collection.createIndex(
        { startedAt: 1 },
        { name: "checkpointRuns_startedAt", expireAfterSeconds: 7 * 86400, maxTimeMS: 2000 }
      );
      initialized.add(database);
    }
    await collection.insertOne(record);
    recorded = true;
  } catch (error) {
    console.error("[checkpoint-telemetry] start could not be recorded", error);
  }
  async function finish(fields: Partial<CheckpointRun>) {
    if (!recorded || !database) return;
    try {
      await database
        .collection<CheckpointRun>("checkpointRuns")
        .updateOne(
          { _id: record._id },
          { $set: { ...fields, completedAt: new Date(), durationMs: Date.now() - started } },
          { maxTimeMS: 2000 }
        );
    } catch (error) {
      console.error("[checkpoint-telemetry] completion could not be recorded", error);
    }
  }
  try {
    const result = await run();
    if (!result) {
      await finish({ state: "skipped" });
      return result;
    }
    const failures = Object.entries(result.steps ?? {})
      .filter(([, step]) => "error" in step)
      .map(([name]) => name);
    // A market skip during the composite tick means its work was incomplete.
    if (kind === "half-hour" && result.market === null) failures.push("markets");
    await finish({
      state: failures.length ? "degraded" : "clean",
      turn: result.turn,
      failures,
      corpsRepriced: result.corpsRepriced ?? result.market?.corpsRepriced,
    });
    return result;
  } catch (error) {
    await finish({ state: "aborted" });
    throw error;
  }
}
