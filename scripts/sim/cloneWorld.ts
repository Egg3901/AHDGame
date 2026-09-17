/**
 * Clone the live game world into an isolated sim sandbox DB, for quick
 * clone-mode runs (see runWorld.ts --clone-mode). Copies STATE, not history:
 * the large append-only log/audit collections are excluded because the turn
 * engine never reads them and they dominate the data volume.
 *
 * Required env:
 *   SOURCE_MONGODB_URI  — the live game DB connection (read-only usage)
 *   SOURCE_DB_NAME      — live game db name
 *   SIM_MONGODB_URI     — sandbox MongoDB (the copy destination)
 *
 * Usage: npx tsx scripts/sim/cloneWorld.ts --db=ahd_sim_clone_foo [--drop]
 *        npx tsx scripts/sim/cloneWorld.ts --db=ahd_sim_baseline_<id> [--capture-id=<id>]
 *
 * Baseline captures (dest ahd_sim_baseline_<id>) hold a durable exclusive
 * `capturing` reservation in the destination's simBaselines collection BEFORE
 * any destructive work: concurrent first captures under the same baselineId
 * serialize on the reservation _id (losers refuse, same --capture-id
 * resumes a crashed capture), and a sealed snapshot refuses recapture. The
 * reservation survives the capture because baseline dests are cleared
 * collection-by-collection (simBaselines kept), never dropDatabase'd. Seal
 * with stampBaseline.ts afterwards; arms may only claim sealed snapshots.
 *
 * The destination name MUST start with "ahd_sim_" — the same convention the
 * sim worker enforces — so a mistyped flag can never bulldoze a real DB.
 */

import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";
import {
  assertBaselineId,
  assertSafeToken,
  BASELINE_CLONE_EXCLUDED_COLLECTIONS,
  BASELINE_MARKER_COLLECTION,
  buildCaptureReservationDoc,
  isBaselineDbName,
  resolveBaselineCapture,
  type BaselineMarkerDoc,
} from "./simJobArgs";

const SOURCE_MONGODB_URI = process.env.SOURCE_MONGODB_URI;
const SOURCE_DB_NAME = process.env.SOURCE_DB_NAME || "a-house-divided";
const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;

/**
 * Append-only history, telemetry, audit and ops collections the engine never
 * reads during a turn. Everything NOT listed here is copied. When in doubt a
 * collection is copied: a stale extra collection is inert, a missing one can
 * break the engine mid-run. Owned by ./baselineManifest (shared with the
 * seal) so copy coverage and seal coverage can never disagree.
 */
const EXCLUDED_COLLECTIONS = BASELINE_CLONE_EXCLUDED_COLLECTIONS;

const BATCH = 2000;

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  if (!SOURCE_MONGODB_URI) throw new Error("SOURCE_MONGODB_URI is required");
  if (!SIM_MONGODB_URI) throw new Error("SIM_MONGODB_URI is required");
  const destName = arg("db");
  if (!destName || !/^ahd_sim_[a-zA-Z0-9_-]+$/.test(destName)) {
    throw new Error("--db is required and must match ^ahd_sim_[a-zA-Z0-9_-]+$");
  }
  const drop = process.argv.includes("--drop");

  const src = new MongoClient(SOURCE_MONGODB_URI);
  const dst = new MongoClient(SIM_MONGODB_URI);
  await src.connect();
  await dst.connect();
  const sdb = src.db(SOURCE_DB_NAME);
  const ddb = dst.db(destName);

  // Durable exclusive first-capture gate (issue #1470 experiment-integrity
  // closure): a baseline-named dest holds a `capturing` reservation in its
  // own simBaselines collection BEFORE any destructive work, so concurrent
  // same-baselineId first captures serialize on the reservation _id instead
  // of overwriting each other. A sealed snapshot refuses recapture; a
  // competing captureId refuses; the same captureId resumes a crashed
  // capture. Refusals happen before any write, leaving the referenced
  // snapshot untouched. Arm dbs (never baseline-named) skip this entirely,
  // so idempotent worker re-copies are unaffected.
  if (isBaselineDbName(destName)) {
    const baselineId = assertBaselineId(destName.slice("ahd_sim_baseline_".length));
    const captureId = arg("capture-id") ?? `capture-${Date.now()}-${randomUUID().slice(0, 8)}`;
    assertSafeToken(captureId, "capture-id");
    try {
      await ddb
        .collection(BASELINE_MARKER_COLLECTION)
        .insertOne(buildCaptureReservationDoc(baselineId, captureId, new Date()) as never);
      console.log(
        `[clone] capture reservation acquired for baseline "${baselineId}" (captureId=${captureId})`
      );
    } catch (err) {
      if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== 11000) {
        throw err;
      }
      const existing = (await ddb
        .collection(BASELINE_MARKER_COLLECTION)
        .findOne({ _id: baselineId as never })) as BaselineMarkerDoc | null;
      const verdict = resolveBaselineCapture(existing, captureId);
      if (verdict === "resume") {
        console.log(
          `[clone] resuming crashed capture of baseline "${baselineId}" (captureId=${captureId})`
        );
        await ddb
          .collection(BASELINE_MARKER_COLLECTION)
          .updateOne({ _id: baselineId as never }, { $set: { checkedAt: new Date() } });
      }
    }
    // Baseline dests are cleared collection-by-collection (simBaselines kept)
    // instead of dropDatabase, so the reservation above survives the capture
    // it serializes. A crashed capture therefore always leaves either no
    // marker (retry proceeds as a first capture) or its reservation
    // (retry resumes with the same --capture-id) — never a half-dropped db
    // another capturer can mistake for a clean target.
    const destCollections = await ddb.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of destCollections) {
      if (name.startsWith("system.") || name === BASELINE_MARKER_COLLECTION) continue;
      await ddb.collection(name).deleteMany({});
    }
    console.log(`[clone] cleared ${destName} (reservation kept)`);
  } else if (drop) {
    await ddb.dropDatabase();
    console.log(`[clone] dropped ${destName}`);
  }

  // Refuse a source that does not look like a game world — cloning the sim
  // control-plane by URI mixup copies 3 metadata collections and the engine
  // then silently bootstraps a fresh world instead of continuing the clone.
  const gameStateDoc = await sdb.collection("gameState").findOne({ _id: "current" as never });
  const corpCount = await sdb.collection("corporations").countDocuments();
  if (!gameStateDoc || corpCount === 0) {
    throw new Error(
      `source db "${SOURCE_DB_NAME}" has no gameState/current or no corporations — ` +
        "this is not a live game world; check SOURCE_MONGODB_URI/SOURCE_DB_NAME"
    );
  }

  const collections = (await sdb.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !EXCLUDED_COLLECTIONS.has(n))
    .sort();

  let totalDocs = 0;
  const started = Date.now();
  for (const name of collections) {
    const cursor = sdb.collection(name).find({}, { batchSize: BATCH });
    let batch: object[] = [];
    let copied = 0;
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await ddb.collection(name).insertMany(batch as never[], { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await ddb.collection(name).insertMany(batch as never[], { ordered: false });
      copied += batch.length;
    }
    totalDocs += copied;
    if (copied > 0) console.log(`[clone] ${name}: ${copied}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[clone] done: ${collections.length} collections, ${totalDocs} docs -> ${destName} in ${secs}s ` +
      `(${EXCLUDED_COLLECTIONS.size} history/log collections excluded)` +
      (isBaselineDbName(destName)
        ? ` — seal it next: stampBaseline.ts --baseline-id=${destName.slice("ahd_sim_baseline_".length)}`
        : "")
  );
  await src.close();
  await dst.close();
}

main().catch((err) => {
  console.error("[clone] FAILED:", err);
  process.exit(1);
});
