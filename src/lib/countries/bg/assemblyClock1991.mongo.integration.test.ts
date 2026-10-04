import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { State } from "@/lib/db/types";
import { BG_FOUNDING_COUNTS_COLLECTION } from "./foundingCount1990";
import { loadBgGrandAssemblyClock } from "./grandAssemblyClock1991";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { ensureBGElections } from "./elections";
import { bgRegions1991 } from "./data/bgRegions1991";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/discord/send", () => ({ sendToDiscord: vi.fn().mockResolvedValue(undefined) }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const now = new Date("2026-01-01T00:00:00Z");
describe.skipIf(!uri)("Bulgarian Assembly scheduler on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Qualification requires loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (event) => {
      commands++;
      requestBytes += BSON.calculateObjectSize(event.command);
    });
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
    });
    await client.connect();
    vi.mocked(getMongoClient).mockResolvedValue(client);
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Qualification requires writable replica set");
  });
  afterAll(async () => {
    await client?.close();
  });

  async function fixture(authorized: boolean, preIterationActive = false) {
    const db = client.db(`ahd_test_bg_clock_${new ObjectId().toHexString()}`);
    await db.collection("gameState").insertOne({
      _id: "current" as never,
      preset: "1991-default",
      startingYear: 1991,
      currentTurn: 49,
      preIterationTurns: 48,
      preIteration: { active: preIterationActive },
    });
    await db.collection("countryGameStates").insertOne({
      _id: "BG" as never,
      status: "beta",
      ...(authorized ? { bgConstitution1991SinceTurn: 49 } : {}),
    });
    await db.collection<State>("states").insertMany(bgRegions1991);
    await db.collection("elections").insertMany(
      bgRegions1991.map((region) => ({
        _id: new ObjectId(),
        countryId: "BG",
        electionType: "nationalAssembly",
        state: region._id,
        cycle: 0,
        status: "resolved",
        totalSeats: region.houseDistricts,
        startTurn: 1,
        primaryEndTurn: 24,
        endTurn: 48,
        updatedAt: new Date(now.getTime() - 3600000),
        resolvedAt: new Date(now.getTime() - 3600000),
      }))
    );
    vi.mocked(getDb).mockResolvedValue(db);
    return db;
  }
  it("retains all five Grand regions until their original four-year term", async () => {
    const db = await fixture(false);
    try {
      await ensureBGElections(now);
      const polls = await db.collection("elections").find({ status: "active" }).toArray();
      expect(polls).toHaveLength(5);
      expect(polls.every((row) => row.endTurn === 216 && row.electionYear === 1994)).toBe(true);
      expect(polls.reduce((sum, row) => sum + row.totalSeats, 0)).toBe(400);
      await ensureBGElections(now);
      expect(await db.collection("elections").countDocuments({ status: "active" })).toBe(5);
    } finally {
      await db.dropDatabase();
    }
  });
  it("starts one coherent ordinary cohort after consent and retains its actual term anchor", async () => {
    const db = await fixture(true);
    try {
      commands = requestBytes = replyBytes = 0;
      await ensureBGElections(now);
      const measured = { commands, requestBytes, replyBytes };
      process.stdout.write(`BGordinaryClockSpawn ${JSON.stringify(measured)}\n`);
      expect(measured.commands).toBeLessThanOrEqual(20);
      let polls = await db.collection("elections").find({ status: "active" }).toArray();
      expect(polls).toHaveLength(5);
      expect(
        polls.every(
          (row) =>
            row.primaryEndTurn === 53 && row.endTurn === 55 && row.shiftedScheduleEndTurn === 55
        )
      ).toBe(true);
      expect(polls.reduce((sum, row) => sum + row.totalSeats, 0)).toBe(240);
      expect(polls.every((row) => row.totalSeats === BG_ORDINARY_ASSEMBLY_SEATS[row.state])).toBe(
        true
      );
      await db
        .collection("elections")
        .updateMany(
          { cycle: 1 },
          { $set: { status: "resolved", updatedAt: new Date(now.getTime() - 1800000) } }
        );
      await db.collection("gameState").updateOne({}, { $set: { currentTurn: 56 } });
      await ensureBGElections(now);
      polls = await db.collection("elections").find({ status: "active" }).toArray();
      expect(polls).toHaveLength(5);
      expect(polls.every((row) => row.cycle === 2 && row.endTurn === 247)).toBe(true);
    } finally {
      await db.dropDatabase();
    }
  });

  it("aligns only native founding office dates once, retaining legacy offices and financial owners", async () => {
    const db = await fixture(false);
    try {
      await db
        .collection(BG_FOUNDING_COUNTS_COLLECTION)
        .insertOne({ _id: "BG:founding1990:0" as never, seatedAtTurn: 48 });
      const nativeId = new ObjectId(),
        legacyId = new ObjectId(),
        ownerId = new ObjectId();
      await db.collection("electedOfficials").insertMany([
        ...Array.from({ length: 399 }, () => ({
          _id: new ObjectId(),
          countryId: "BG",
          officeType: "assemblyDeputy",
          nppId: ownerId,
          termEnds: now,
          bulgarianFoundingMandate: { receiptId: "BG:founding1990:0" },
        })),
        {
          _id: nativeId,
          countryId: "BG",
          officeType: "assemblyDeputy",
          nppId: ownerId,
          termEnds: now,
          bulgarianFoundingMandate: { receiptId: "BG:founding1990:0" },
        },
        { _id: legacyId, countryId: "BG", officeType: "assemblyDeputy", termEnds: now },
      ]);
      await db.collection("npps").insertOne({ _id: ownerId, balance: 1234 });
      const ctx = { preset: "1991-default", startingYear: 1991, preIterationTurns: 48 };
      expect(
        await loadBgGrandAssemblyClock(db, { ...ctx, preIterationActive: true }, 49, now)
      ).toBeUndefined();
      expect(
        (await db.collection("electedOfficials").findOne({ _id: nativeId }))?.termEnds
      ).toEqual(now);
      await db.command({
        collMod: BG_FOUNDING_COUNTS_COLLECTION,
        validator: { $expr: { $eq: [{ $type: "$grandTermEndTurn" }, "missing"] } },
        validationLevel: "strict",
      });
      await expect(loadBgGrandAssemblyClock(db, ctx, 49, now)).rejects.toThrow();
      expect(
        (await db.collection("electedOfficials").findOne({ _id: nativeId }))?.termEnds
      ).toEqual(now);
      expect(
        (await db.collection(BG_FOUNDING_COUNTS_COLLECTION).findOne({}))?.grandTermEndTurn
      ).toBeUndefined();
      await db.command({ collMod: BG_FOUNDING_COUNTS_COLLECTION, validator: {} });
      commands = requestBytes = replyBytes = 0;
      expect(await loadBgGrandAssemblyClock(db, ctx, 49, now)).toBe(216);
      process.stdout.write(
        `BGgrandClockAlignment ${JSON.stringify({ commands, requestBytes, replyBytes })}\n`
      );
      expect(commands).toBeLessThanOrEqual(6);
      expect(
        (await db.collection("electedOfficials").findOne({ _id: nativeId }))?.termEnds
      ).toEqual(new Date(now.getTime() + 167 * 3600000));
      expect(
        (await db.collection("electedOfficials").findOne({ _id: legacyId }))?.termEnds
      ).toEqual(now);
      expect((await db.collection("npps").findOne({ _id: ownerId }))?.balance).toBe(1234);
      const before = await db.collection("electedOfficials").find().toArray();
      commands = requestBytes = replyBytes = 0;
      const concurrent = await Promise.all([
        loadBgGrandAssemblyClock(db, ctx, 50, now),
        loadBgGrandAssemblyClock(db, ctx, 50, now),
      ]);
      expect(concurrent).toEqual([216, 216]);
      expect(commands).toBe(2);
      expect(await db.collection("electedOfficials").find().toArray()).toEqual(before);
    } finally {
      await db.dropDatabase();
    }
  });

  it("opens no new regional campaign while another region waits for national certification", async () => {
    const db = await fixture(true);
    try {
      await db
        .collection("elections")
        .updateOne({ state: bgRegions1991[0]._id }, { $set: { status: "completed" } });
      await ensureBGElections(now);
      expect(await db.collection("elections").countDocuments({ status: "active" })).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it("does not restart a settled founding election while other countries are still founding", async () => {
    const db = await fixture(false, true);
    try {
      await ensureBGElections(now);
      expect(await db.collection("elections").countDocuments()).toBe(5);
    } finally {
      await db.dropDatabase();
    }
  });
});
