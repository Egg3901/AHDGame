import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import type { Db, Document } from "mongodb";
import { z } from "zod";

export const preparedSandboxSchema = z
  .object({
    gameStateSha256: z.string().regex(/^[a-f0-9]{64}$/),
    gameConfigSha256: z.string().regex(/^[a-f0-9]{64}$/),
    initialTurn: z.number().int().min(1),
  })
  .strict();
export type PreparedSandbox = z.infer<typeof preparedSandboxSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

/** Hash BSON's JSON representation with stable property ordering. */
export function preparedConfigurationHash(document: Document): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(document)))))
    .digest("hex");
}

export function preservedAutonomyLevel(level: unknown): "v3" | "v4" | "v5" {
  if (level === "v3" || level === "v4" || level === "v5") return level;
  throw new Error("Preserved sandbox must declare its actual autonomy level");
}

/** Read-only admission. It never clones production or edits the prepared world. */
export async function inspectPreparedSandbox(db: Db, preset: string, requested: PreparedSandbox) {
  const expected = preparedSandboxSchema.parse(requested);
  assert.match(db.databaseName, /^ahd_sim_[a-zA-Z0-9_-]{1,64}$/);
  const [state, config, baseline, diagnostic, officials, npps, states] = await Promise.all([
    db.collection("gameState").findOne({ _id: "current" as never }),
    db.collection("gameConfig").findOne({ _id: "default" as never }),
    db.collection("seedDiagnosticBaselines").findOne({ _id: "current" as never }),
    db
      .collection("seedDiagnostics")
      .findOne({ preset, mode: "conformance" }, { sort: { ranAt: -1 } }),
    db.collection("electedOfficials").countDocuments({}),
    db.collection("npps").countDocuments({ retiredAt: null }),
    db.collection("states").countDocuments({}),
  ]);
  assert(
    state && config && baseline && diagnostic,
    "Prepared world, baseline and conformance must exist"
  );
  assert(officials > 0 && npps > 0 && states > 0, "Prepared world is not bootstrapped");
  assert.equal(state.preset, preset, "Prepared profile mismatch");
  assert.equal(state.currentTurn, expected.initialTurn, "Prepared clock mismatch");
  assert.equal(state.isActive, false, "Prepared world must be paused");
  assert.notEqual(state.isProcessing, true, "Prepared world is processing");
  assert.equal(config.maintenanceMode, "full", "Prepared world must be sealed");
  assert.equal(config.lastReset?.status, "succeeded", "Prepared reset did not succeed");
  assert.equal(config.ledgerShadow, true, "Preserved run requires already-enabled shadow ledger");
  assert.equal(baseline.preset, preset, "Prepared baseline profile mismatch");
  assert.equal(baseline.turn, expected.initialTurn, "Prepared baseline clock mismatch");
  assert.equal(diagnostic.summary?.critical, 0, "Prepared conformance is blocked");
  assert.equal(
    preparedConfigurationHash(state),
    expected.gameStateSha256,
    "Prepared gameState changed"
  );
  assert.equal(
    preparedConfigurationHash(config),
    expected.gameConfigSha256,
    "Prepared gameConfig changed"
  );
  return {
    ...expected,
    preset,
    autonomyLevel: preservedAutonomyLevel(state.nppAutonomyLevel),
    startingPartiesMode: state.startingPartiesMode ?? "default",
    baselineCapturedAt: baseline.capturedAt,
    conformanceSource: diagnostic.sourceRevision ?? null,
    verifiedAt: new Date(),
  };
}

/** Activate only the admitted isolated copy; maintenance and gameplay settings stay sealed. */
export async function activatePreparedSandbox(db: Db, preset: string, requested: PreparedSandbox) {
  const validation = await inspectPreparedSandbox(db, preset, requested);
  const result = await db.collection("gameState").updateOne(
    {
      _id: "current" as never,
      currentTurn: requested.initialTurn,
      isActive: false,
      isProcessing: { $ne: true },
    },
    { $set: { isActive: true } }
  );
  assert.equal(result.matchedCount, 1, "Prepared activation lost its paused clock claim");
  return validation;
}
