/**
 * Stamp the paired-baseline marker on an immutable sandbox snapshot (issue
 * #1470 experiment-validity audit).
 *
 * The supervisor captures a baseline ONCE from live into the sandbox db
 * baselineDbNameFor(baselineId) with cloneWorld.ts (SOURCE at the live DB:
 * the only paired-baseline step that ever reads live), then runs this script
 * to record what was captured. The sim worker refuses to claim a baselined
 * arm whose snapshot db carries no marker for its baseline id, and this
 * script refuses to re-stamp a snapshot whose turn or doc count moved (which
 * means something ran against the baseline db, so it is no longer immutable).
 *
 * Sandbox only: SIM_MONGODB_URI must point at the sandbox Mongo, never the
 * live game database. The destination db is derived from --baseline-id, so a
 * mistyped flag cannot stamp (or bulldoze) a real DB.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://... npx tsx scripts/sim/stampBaseline.ts --baseline-id=<id>
 */

import { MongoClient } from "mongodb";
import { assertBaselineStampCompatible, baselineDbNameFor } from "./simJobArgs";

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  if (!SIM_MONGODB_URI) throw new Error("SIM_MONGODB_URI is required (sandbox MongoDB)");
  const baselineId = arg("baseline-id");
  if (!baselineId) throw new Error("--baseline-id is required");
  const dbName = baselineDbNameFor(baselineId);

  const client = new MongoClient(SIM_MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(dbName);

    // Same world-likeness guard as cloneWorld.ts: refuse to stamp a db that
    // is not a captured game world (e.g. an empty or metadata-only db).
    const gameState = await db.collection("gameState").findOne({ _id: "current" as never });
    const corpCount = await db.collection("corporations").countDocuments();
    if (!gameState || corpCount === 0) {
      throw new Error(
        `sandbox db "${dbName}" has no gameState/current or no corporations: ` +
          "this is not a captured baseline; clone it from live with cloneWorld.ts first"
      );
    }
    const sourceTurn = Number((gameState as { currentTurn?: unknown }).currentTurn ?? 0);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    let docCount = 0;
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue;
      docCount += await db.collection(name).estimatedDocumentCount();
    }
    const observed = { baselineId, sourceTurn, docCount };

    const existing = await db.collection("simBaselines").findOne({ _id: baselineId as never });
    assertBaselineStampCompatible(
      existing
        ? {
            baselineId,
            sourceTurn: Number((existing as { sourceTurn?: unknown }).sourceTurn ?? -1),
            docCount: Number((existing as { docCount?: unknown }).docCount ?? -1),
          }
        : null,
      observed
    );

    const now = new Date();
    await db.collection("simBaselines").updateOne(
      { _id: baselineId as never },
      {
        $setOnInsert: { _id: baselineId, stampedAt: now },
        $set: { sourceTurn, docCount, checkedAt: now },
      },
      { upsert: true }
    );
    console.log(
      `[baseline:${baselineId}] stamped ${dbName} (turn=${sourceTurn}, docs~${docCount})`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[baseline] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
