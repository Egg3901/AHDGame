import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activatePreparedSandbox,
  inspectPreparedSandbox,
  preparedConfigurationHash,
} from "./preparedSandbox";

import { SIM_JOB_CLAIM_SORT } from "./simJobHandoff";

const uri = process.env.PREPARED_SANDBOX_TEST_URI;
const suite = uri ? describe : describe.skip;

suite("prepared sandbox native admission", () => {
  let client: MongoClient;
  let db: Db;
  let serial = 0;
  const names: string[] = [];
  const state = {
    _id: "current",
    preset: "1991-default",
    currentTurn: 1,
    isActive: false,
    isProcessing: false,
    nppAutonomyLevel: "v4",
    startingPartiesMode: "none",
  };
  const config = {
    _id: "default",
    maintenanceMode: "full",
    ledgerShadow: true,
    lastReset: { status: "succeeded" },
    marketSystemMode: "plants",
  };
  const prepared = {
    gameStateSha256: preparedConfigurationHash(state),
    gameConfigSha256: preparedConfigurationHash(config),
    initialTurn: 1,
  };

  beforeAll(async () => {
    const target = new URL(uri!);
    expect(target.hostname).toBe("127.0.0.1");
    expect(target.port).toBe("27018");
    client = await new MongoClient(uri!).connect();
  });
  beforeEach(async () => {
    const name = `ahd_sim_prepared_guard_${process.pid}_${++serial}`;
    names.push(name);
    db = client.db(name);
    await db.collection<{ _id: string }>("gameState").insertOne({ ...state });
    await db.collection<{ _id: string }>("gameConfig").insertOne({ ...config });
    await db.collection("seedDiagnosticBaselines").insertOne({
      _id: "current" as never,
      preset: "1991-default",
      turn: 1,
      capturedAt: new Date(),
    });
    await db.collection("seedDiagnostics").insertOne({
      preset: "1991-default",
      mode: "conformance",
      ranAt: new Date(),
      sourceRevision: "a".repeat(40),
      summary: { critical: 0 },
    });
    for (const collection of ["states", "npps", "electedOfficials"])
      await db.collection(collection).insertOne({ fixture: true });
  });
  afterAll(async () => {
    if (!client) return;
    for (const name of names) {
      expect(name).toMatch(/^ahd_sim_prepared_guard_/);
      await client.db(name).dropDatabase();
    }
    await client.close();
  });

  it("admits matching state without writes and activates only the isolated copy", async () => {
    const admitted = await inspectPreparedSandbox(db, "1991-default", prepared);
    expect(admitted.autonomyLevel).toBe("v4");
    expect(admitted.startingPartiesMode).toBe("none");
    expect(await db.collection("gameState").findOne({})).toEqual(state);
    await activatePreparedSandbox(db, "1991-default", prepared);
    expect(await db.collection("gameState").findOne({})).toEqual({ ...state, isActive: true });
    expect(await db.collection("gameConfig").findOne({})).toEqual(config);
  });

  it.each([
    ["gameConfig", { $set: { marketSystemMode: "off" } }],
    ["gameState", { $set: { nppAutonomyLevel: "v3" } }],
    ["gameState", { $set: { currentTurn: 2 } }],
    ["gameState", { $set: { isActive: true } }],
    ["gameState", { $set: { isProcessing: true } }],
    ["gameConfig", { $set: { maintenanceMode: "off" } }],
    ["gameConfig", { $set: { "lastReset.status": "partial" } }],
    ["seedDiagnostics", { $set: { "summary.critical": 1 } }],
    ["seedDiagnosticBaselines", { $set: { preset: "2027-default" } }],
  ])("rejects changed %s before activation", async (collection, update) => {
    await db.collection(collection).updateOne({}, update);
    const before = await db.collection("gameState").findOne({});
    await expect(activatePreparedSandbox(db, "1991-default", prepared)).rejects.toThrow();
    expect(await db.collection("gameState").findOne({})).toEqual(before);
  });

  it("refuses an incomplete world instead of bootstrapping it", async () => {
    await db.collection("electedOfficials").deleteMany({});
    await expect(activatePreparedSandbox(db, "1991-default", prepared)).rejects.toThrow(
      "not bootstrapped"
    );
    expect((await db.collection("gameState").findOne({}))?.isActive).toBe(false);
  });

  it("claims an explicit prerequisite first without rewriting the timeline", async () => {
    const jobs = db.collection<{
      _id: string;
      status: string;
      createdAt: Date;
      queuePriority?: number;
    }>("simJobs");
    const old = new Date("1991-01-01T00:00:00Z");
    const recent = new Date("1991-01-02T00:00:00Z");
    await jobs.insertMany([
      { _id: "legacy", status: "queued", createdAt: old },
      { _id: "prerequisite", status: "queued", createdAt: recent, queuePriority: 1 },
    ]);
    const claimed = await jobs.findOneAndUpdate(
      { status: "queued" },
      { $set: { status: "running" } },
      { sort: SIM_JOB_CLAIM_SORT, returnDocument: "after" }
    );
    expect(claimed?._id).toBe("prerequisite");
    expect(claimed?.createdAt).toEqual(recent);
    expect((await jobs.findOne({ _id: "legacy" }))?.createdAt).toEqual(old);
  });

  it("keeps legacy jobs in their original oldest-first order", async () => {
    const jobs = db.collection<{ _id: string; status: string; createdAt: Date }>("simJobs");
    await jobs.insertMany([
      { _id: "newer", status: "queued", createdAt: new Date("1991-01-02T00:00:00Z") },
      { _id: "older", status: "queued", createdAt: new Date("1991-01-01T00:00:00Z") },
    ]);
    const claimed = await jobs.findOneAndUpdate(
      { status: "queued" },
      { $set: { status: "running" } },
      { sort: SIM_JOB_CLAIM_SORT, returnDocument: "after" }
    );
    expect(claimed?._id).toBe("older");
  });

  it("rejects production namespace before any read or activation", async () => {
    await expect(
      activatePreparedSandbox(client.db("a-house-divided"), "1991-default", prepared)
    ).rejects.toThrow();
  });
});
