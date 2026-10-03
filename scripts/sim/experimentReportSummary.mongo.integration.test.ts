import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  planTimelineChunks,
  readExperimentReport,
  readExperimentReportSummary,
  SIM_EXPERIMENT_REPORT_CHUNKS,
  SIM_EXPERIMENT_REPORTS,
  type StoredExperimentReport,
  writeExperimentReport,
} from "./experimentReportStorage";

const uri = process.env.FEDERATION_TEST_MONGO_URI;
describe.skipIf(!uri)("bounded experiment report summary on actual Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const url = new URL(uri!);
    if (url.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Qualification requires explicit isolated loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (event) => {
      commands++;
      requestBytes += BSON.calculateObjectSize(event.command);
    });
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Qualification requires writable replica set");
  });
  afterAll(async () => {
    await client?.close();
  });
  const sample = <T>(points: T[], max = 10) =>
    points.length <= max
      ? points
      : Array.from(
          { length: max },
          (_, index) => points[Math.floor(index * (points.length / max))]
        );

  it("matches full-read sampling across chunks while transferring no nested telemetry", async () => {
    const db = client.db(`ahd_test_report_summary_${new ObjectId().toHexString()}`);
    try {
      const source = {
        turn: 480,
        finalMetrics: { completed: true },
        seatsTimeline: Array.from({ length: 103 }, (_, turn) => ({ turn, seats: turn + 1 })),
        partyOrgTimeline: Array.from({ length: 29 }, (_, turn) => ({ turn, members: turn * 2 })),
        corporationsTimeline: [{ turn: 480, companies: 10 }],
        longHorizonTelemetry: {
          approval: {
            points: Array.from({ length: 1500 }, (_, turn) => ({
              turn,
              payload: "x".repeat(18000),
            })),
            series: [],
          },
          macro: { points: [], series: [] },
        },
      };
      await writeExperimentReport(db, "large", source);
      // Split the selected timeline across several chunks to exercise global offsets.
      const original = await db
        .collection(SIM_EXPERIMENT_REPORT_CHUNKS)
        .findOne({ runId: "large", field: "seatsTimeline" });
      expect(original).not.toBeNull();
      const generation = original!.generation;
      const replacements = planTimelineChunks(
        "large",
        generation,
        { seatsTimeline: source.seatsTimeline },
        350
      );
      await db
        .collection(SIM_EXPERIMENT_REPORT_CHUNKS)
        .deleteMany({ runId: "large", field: "seatsTimeline" });
      await db.collection(SIM_EXPERIMENT_REPORT_CHUNKS).insertMany(replacements);
      await db.collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS).updateOne(
        { _id: "large" },
        {
          $inc: { "timelineStorage.chunkCount": replacements.length - 1 },
          $set: { "timelineStorage.fields.0.chunkCount": replacements.length },
        }
      );
      commands = requestBytes = replyBytes = 0;
      const full = await readExperimentReport(db, "large");
      const baseline = { commands, requestBytes, replyBytes };
      commands = requestBytes = replyBytes = 0;
      const summary = await readExperimentReportSummary(db, "large", 10);
      const bounded = { commands, requestBytes, replyBytes };
      expect(summary?.seatsTimeline).toEqual(sample(full!.seatsTimeline!));
      expect(summary?.partyOrgTimeline).toEqual(sample(source.partyOrgTimeline));
      expect(summary?.corporationsTimeline).toEqual(source.corporationsTimeline);
      expect(summary?.finalMetrics).toEqual(source.finalMetrics);
      expect(summary?.longHorizonTelemetry).toBeUndefined();
      expect(bounded.commands).toBe(3);
      expect(bounded.replyBytes).toBeLessThan(20_000);
      expect(baseline.replyBytes).toBeGreaterThan(26_000_000);
      process.stdout.write(
        JSON.stringify({ fixture: "bounded-report-summary", baseline, bounded }) + "\n"
      );
    } finally {
      await db.dropDatabase();
    }
  });

  it("samples legacy inline reports before transfer and keeps version-one chunk compatibility", async () => {
    const db = client.db(`ahd_test_report_legacy_${new ObjectId().toHexString()}`);
    try {
      const source = {
        seatsTimeline: Array.from({ length: 71 }, (_, turn) => ({ turn })),
        partyOrgTimeline: [],
        corporationsTimeline: [],
      };
      await db.collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS).insertOne({
        _id: "inline",
        ...source,
        longHorizonTelemetry: { payload: "unrequested".repeat(10000) },
      });
      const chunks = planTimelineChunks("old", "version-one", source, 350);
      await db.collection(SIM_EXPERIMENT_REPORT_CHUNKS).insertMany(chunks);
      await db.collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS).insertOne({
        _id: "old",
        timelineStorage: { version: 1, generation: "version-one", chunkCount: chunks.length },
      });
      for (const id of ["inline", "old"]) {
        const summary = await readExperimentReportSummary(db, id, 10);
        expect(summary?.seatsTimeline).toEqual(sample(source.seatsTimeline));
        expect(summary?.partyOrgTimeline).toEqual([]);
        expect(summary?.longHorizonTelemetry).toBeUndefined();
      }
      expect(await readExperimentReportSummary(db, "missing", 10)).toBeNull();
    } finally {
      await db.dropDatabase();
    }
  });

  it("refuses missing unrelated telemetry chunks instead of hiding incomplete collection", async () => {
    const db = client.db(`ahd_test_report_missing_${new ObjectId().toHexString()}`);
    try {
      await writeExperimentReport(db, "broken", {
        seatsTimeline: [{ turn: 1 }],
        longHorizonTelemetry: { macro: { points: [{ turn: 1 }] } },
      });
      await db
        .collection(SIM_EXPERIMENT_REPORT_CHUNKS)
        .deleteOne({ runId: "broken", field: "longHorizonTelemetry.macro.points" });
      await expect(readExperimentReportSummary(db, "broken", 10)).rejects.toThrow(
        "expected 2 timeline chunks, found 1"
      );
    } finally {
      await db.dropDatabase();
    }
  });

  it("rejects duplicate sequence and false field counts", async () => {
    const db = client.db(`ahd_test_report_invalid_${new ObjectId().toHexString()}`);
    try {
      const source = { seatsTimeline: [{ turn: 1 }, { turn: 2 }] };
      const chunks = planTimelineChunks("bad-sequence", "bad", source, 100);
      await db
        .collection(SIM_EXPERIMENT_REPORT_CHUNKS)
        .insertMany(chunks.map((chunk) => ({ ...chunk, sequence: 0 })));
      await db.collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS).insertOne({
        _id: "bad-sequence",
        timelineStorage: { version: 1, generation: "bad", chunkCount: chunks.length },
      });
      await expect(readExperimentReportSummary(db, "bad-sequence", 10)).rejects.toThrow(
        "Non-contiguous"
      );
      await writeExperimentReport(db, "bad-count", source);
      await db
        .collection<StoredExperimentReport>(SIM_EXPERIMENT_REPORTS)
        .updateOne({ _id: "bad-count" }, { $set: { "timelineStorage.fields.0.pointCount": 999 } });
      await expect(readExperimentReportSummary(db, "bad-count", 10)).rejects.toThrow(
        "Incomplete report field"
      );
    } finally {
      await db.dropDatabase();
    }
  });

  it("rejects invalid sampling limits before any database request", async () => {
    const db = client.db(`ahd_test_report_limits_${new ObjectId().toHexString()}`);
    for (const limit of [0, 9, 10.5, 5001, NaN, Infinity]) {
      commands = 0;
      await expect(readExperimentReportSummary(db, "missing", limit)).rejects.toThrow(
        "Report sample limit"
      );
      expect(commands).toBe(0);
    }
  });
});
