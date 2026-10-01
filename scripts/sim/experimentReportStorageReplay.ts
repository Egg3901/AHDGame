/** Real Mongo compatibility and oversized-report regression, isolated sandbox only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient } from "mongodb";
import {
  planTimelineChunks,
  readExperimentReport,
  writeExperimentReport,
  type StoredExperimentReport,
  type TimelineChunk,
} from "./experimentReportStorage";
const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    target = arg("target"),
    output = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_report_storage_[a-zA-Z0-9_-]+$/.test(target) && output);
  const clean = () =>
    assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  clean();
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const client = await new MongoClient(uri).connect();
  try {
    const db = client.db(target);
    assert.equal((await db.listCollections().toArray()).length, 0);
    const source = {
      turn: 100,
      seatsTimeline: Array.from({ length: 100 }, (_, turn) => ({ turn, seats: turn + 1 })),
      partyOrgTimeline: [],
      corporationsTimeline: [],
      finalMetrics: { fixture: true },
      longHorizonTelemetry: {
        schemaVersion: 1,
        availability: "observed-complete",
        approval: {
          points: Array.from({ length: 500 }, (_, turn) => ({ turn, payload: "a".repeat(18000) })),
          series: [{ country: "UK", missingTurns: [] }],
        },
        macro: {
          points: Array.from({ length: 1000 }, (_, turn) => ({ turn, payload: "m".repeat(18000) })),
          series: [],
        },
      },
    };
    const sourceBytes = BSON.calculateObjectSize(source),
      sourceHash = hash(source);
    assert(sourceBytes > 26_000_000);
    const id = "nested-storage-regression";
    await writeExperimentReport(db, id, source);
    const restored = await readExperimentReport(db, id);
    assert(restored);
    for (const [field, value] of Object.entries(source)) assert.deepEqual(restored[field], value);
    assert.equal(hash(source), sourceHash);
    const metadata = await db
      .collection<StoredExperimentReport>("simExperimentReports")
      .findOne({ _id: id });
    assert(metadata);
    const chunks = await db
      .collection<TimelineChunk>("simExperimentReportChunks")
      .find({ runId: id })
      .toArray();
    const sizes = chunks.map((chunk) => BSON.calculateObjectSize(chunk));
    assert(BSON.calculateObjectSize(metadata) < 16 * 1024 * 1024);
    assert(sizes.every((size) => size < 16 * 1024 * 1024));
    const legacy = {
      turn: source.turn,
      seatsTimeline: source.seatsTimeline,
      partyOrgTimeline: [],
      corporationsTimeline: [],
    };
    await db
      .collection<StoredExperimentReport>("simExperimentReports")
      .insertOne({ _id: "inline-storage-regression", ...legacy });
    const v1Id = "v1-storage-regression",
      generation = "legacy-v1";
    const oldChunks = planTimelineChunks(v1Id, generation, legacy, 1000);
    await db.collection<TimelineChunk>("simExperimentReportChunks").insertMany(oldChunks);
    await db.collection<StoredExperimentReport>("simExperimentReports").insertOne({
      _id: v1Id,
      turn: source.turn,
      timelineStorage: { version: 1, generation, chunkCount: oldChunks.length },
    });
    for (const legacyId of ["inline-storage-regression", v1Id]) {
      const read = await readExperimentReport(db, legacyId);
      assert(read);
      for (const [field, value] of Object.entries(legacy)) assert.deepEqual(read[field], value);
    }
    await writeExperimentReport(db, id, source);
    const replaced = await readExperimentReport(db, id);
    assert(replaced);
    for (const [field, value] of Object.entries(source)) assert.deepEqual(replaced[field], value);
    assert.equal(
      await db.collection("simExperimentReportChunks").countDocuments({ runId: id }),
      chunks.length
    );
    clean();
    const report = {
      sourceCommit,
      sourceBytes,
      sourceHash,
      roundtripExact: true,
      metadataBytes: BSON.calculateObjectSize(metadata),
      chunkCount: chunks.length,
      maxChunkBytes: Math.max(...sizes),
      inlineCompatible: true,
      version1Compatible: true,
      repeatReplacesGeneration: true,
      fixture:
        "Synthetic 26 MB nested telemetry and 100-point top-level timeline; no engine execution.",
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
