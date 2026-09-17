/**
 * Seal a paired-baseline snapshot with its v1 full-snapshot manifest (issue
 * #1470 experiment-integrity closure).
 *
 * The supervisor captures a baseline ONCE from live into the sandbox db
 * baselineDbNameFor(baselineId) with cloneWorld.ts (SOURCE at the live DB:
 * the only paired-baseline step that ever reads the live game database),
 * then runs this script to seal what was captured. The sim worker refuses to
 * claim a baselined arm unless the snapshot db carries a `sealed` v1 marker
 * for its baseline id whose manifest still matches the db as observed
 * immediately before the copy (plus a post-copy source/dest re-check), so a
 * mutated, half-captured, or legacy-sealed snapshot fails closed instead of
 * forking arm starts.
 *
 * What the seal covers: every cloned collection and document (the same
 * coverage list cloneWorld.ts copies, owned by ./baselineManifest), hashed
 * per collection plus one overall versioned digest. Key order, document
 * order, collection order, and driver BSON representations never count as
 * drift; an in-place edit, a collection add/drop, or a count change always
 * does, and the claim check names the exact collection.
 *
 * Cost: one streaming scan of the snapshot db in batches of 2000 per
 * collection (O(batch) memory via the v2 builder; ceilings abort
 * mid-iteration). One-time per capture (plus the worker's claim-time
 * scans); unpaired turns and fresh-bootstrap pairs never pay it.
 *
 * Crash recovery: a capture interrupted before this script leaves the
 * cloneWorld `capturing` reservation (or no marker at all). This script
 * completes either into a `sealed` marker; a re-run after a crash simply
 * re-seals the resumed capture. A legacy weak marker (turn/count/hash only)
 * upgrades to v1 here. An already `sealed` marker re-stamps idempotently on
 * the identical observation and refuses on any drift (something ran against
 * the baseline db, so it is no longer immutable).
 *
 * Sandbox only: SIM_MONGODB_URI must point at the sandbox Mongo, never the
 * live game database. The destination db is derived from --baseline-id, so a
 * mistyped flag cannot stamp (or bulldoze) a real DB.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://... npx tsx scripts/sim/stampBaseline.ts --baseline-id=<id>
 */

import { MongoClient } from "mongodb";
import {
  assertBaselineStampCompatible,
  BASELINE_MARKER_COLLECTION,
  BASELINE_SEAL_VERSION,
  baselineDbNameFor,
  isBaselineManifestCollection,
  observeBaselineSnapshot,
  type BaselineMarkerDoc,
} from "./simJobArgs";

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
const BATCH = 2000;

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

    // Same world-likeness guard as cloneWorld.ts: refuse to seal a db that
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

    // Full-snapshot observation: every covered collection streamed doc by
    // doc through the v2 builder (O(batch) memory, ceilings enforced
    // mid-iteration). One-time capture cost, never on unpaired turns.
    const started = Date.now();
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter(isBaselineManifestCollection)
      .sort();
    const manifest = await observeBaselineSnapshot(baselineId, collections, (name) =>
      db.collection(name).find({}, { batchSize: BATCH })
    );
    const observed = { baselineId, sourceTurn, manifest };

    const existing = (await db
      .collection(BASELINE_MARKER_COLLECTION)
      .findOne({ _id: baselineId as never })) as BaselineMarkerDoc | null;
    const upgradingLegacy =
      existing !== null &&
      (existing.sealVersion !== BASELINE_SEAL_VERSION || existing.status !== "sealed");
    assertBaselineStampCompatible(existing, observed);

    const now = new Date();
    const captureId =
      typeof existing?.captureId === "string" ? (existing.captureId as string) : undefined;
    await db.collection(BASELINE_MARKER_COLLECTION).updateOne(
      { _id: baselineId as never },
      {
        $set: {
          baselineId,
          sealVersion: BASELINE_SEAL_VERSION,
          status: "sealed",
          sourceTurn,
          manifest,
          totalDocs: manifest.totalDocs,
          digest: manifest.digest,
          ...(captureId !== undefined ? { captureId } : {}),
          checkedAt: now,
        },
        $setOnInsert: { _id: baselineId, stampedAt: now },
        // Legacy weak-seal fields must not survive beside the manifest:
        // claim reads the manifest only, and a stale stateHash beside a
        // fresh digest would invite exactly the confusion this seal removes.
        $unset: { docCount: "", stateHash: "" },
      },
      { upsert: true }
    );
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[baseline:${baselineId}] sealed ${dbName} v${BASELINE_SEAL_VERSION} ` +
        `(turn=${sourceTurn}, docs=${manifest.totalDocs} in ${manifest.collections.length} collections, ` +
        `digest=${manifest.digest.slice(0, 12)}.., scan=${secs}s${upgradingLegacy ? ", upgraded capture reservation/legacy seal" : ""})`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[baseline] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
