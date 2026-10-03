import { createHash } from "node:crypto";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getMongoClient } from "@/lib/mongodb";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { bgListVacancyFixture } from "./listVacancies1991.testFixture";
import { BG_FOUNDING_COUNTS_COLLECTION } from "./foundingCount1990";
import {
  advanceBg1991ListVacancies,
  BG_1991_LIST_REPLACEMENTS_COLLECTION,
} from "./listVacancies1991";

vi.mock("@/lib/mongodb", () => ({ getMongoClient: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z"),
  GAME = { preset: "1991-default" },
  RECEIPT = "BG:founding1990:0";
const stableId = (id: string) =>
  new ObjectId(createHash("sha256").update(`${RECEIPT}:person:${id}`).digest("hex").slice(0, 24));
type Row = { _id: string; [key: string]: unknown };
describe.skipIf(!uri)("Bulgarian list succession on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (e) => {
      commands++;
      requestBytes += BSON.calculateObjectSize(e.command);
    });
    client.on("commandSucceeded", (e) => {
      replyBytes += BSON.calculateObjectSize({ reply: e.reply }) - 12;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Writable isolated replica set required");
    vi.mocked(getMongoClient).mockResolvedValue(client);
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture() {
    const db = client.db(`ahd_test_bg_lists_${new ObjectId()}`),
      data = bgListVacancyFixture();
    for (const name of [
      BG_FOUNDING_COUNTS_COLLECTION,
      BG_1991_LIST_REPLACEMENTS_COLLECTION,
      "countryGameStates",
      "governmentFormations",
      "electedOfficials",
      "npps",
      "characters",
      "notifications",
      "bgFoundingAssemblyOfficeArchives",
    ])
      await db.createCollection(name);
    await db.collection<Row>("countryGameStates").insertOne({ _id: "BG" });
    await db.collection<Row>("governmentFormations").insertOne({ _id: "BG", totalSeats: 400 });
    await db.collection<Row>(BG_FOUNDING_COUNTS_COLLECTION).insertOne({
      _id: RECEIPT,
      countryId: "BG",
      cycle: 0,
      seatedAtTurn: 0,
      grandTermEndTurn: 216,
      nominations: data.nominations,
      settled: data.settled,
      nominees: [],
      listReplacementGeneration: 0,
    });
    await db.collection("npps").insertMany(
      [...data.ownerIds].map(([state, id]) => ({
        _id: new ObjectId(id),
        countryId: "BG",
        party: "a",
        balance: 777,
        seatsHeld: data.settled.mandates.filter((row) => row.ownerId === id).length,
        currentOffice: {
          type: "assemblyDeputy",
          state,
          seatsHeld: data.settled.mandates.filter((row) => row.ownerId === id).length,
        },
      }))
    );
    await db.collection("electedOfficials").insertMany(
      data.settled.mandates.map((row) => ({
        _id: stableId(row.personId),
        countryId: "BG",
        officeType: "assemblyDeputy",
        nppId: new ObjectId(row.ownerId),
        characterId: null,
        seatsHeld: 1,
        state: row.regionId,
        party: row.partyId,
        termEnds: new Date(NOW.getTime() + 116 * MS_PER_TURN),
        bulgarianFoundingMandate: {
          receiptId: RECEIPT,
          personId: row.personId,
          tier: row.tier,
          districtId: row.districtId,
          rootCandidateId: row.candidateId,
        },
      }))
    );
    return { db, data, slot: data.settled.mandates.find((row) => row.tier === "list")! };
  }
  async function run(db: Db, turn = 100) {
    return advanceBg1991ListVacancies(db, GAME, turn, NOW);
  }
  it("has three compact reads and no writes on an intact chamber", async () => {
    const { db } = await fixture();
    try {
      commands = requestBytes = replyBytes = 0;
      expect(await run(db)).toBe(0);
      process.stdout.write(
        JSON.stringify({ path: "BG list intact", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBe(3);
      expect(replyBytes).toBeLessThan(2000);
      expect(await db.collection(BG_1991_LIST_REPLACEMENTS_COLLECTION).countDocuments()).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["deleted", "ownerless", "zero-seats"])(
    "replaces a%s office exactly once with its original term",
    async (mode) => {
      const { db, data, slot } = await fixture();
      try {
        if (mode === "deleted")
          await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
        else
          await db
            .collection("electedOfficials")
            .updateOne(
              { _id: stableId(slot.personId) },
              { $set: mode === "ownerless" ? { nppId: null } : { seatsHeld: 0 } }
            );
        commands = requestBytes = replyBytes = 0;
        expect(await run(db)).toBe(1);
        process.stdout.write(
          JSON.stringify({ path: `BG list ${mode}`, commands, requestBytes, replyBytes }) + "\n"
        );
        const office = await db
          .collection("electedOfficials")
          .findOne({ _id: stableId(slot.personId) });
        expect(office?.bulgarianFoundingMandate.personId).toBe(
          data.nominations.lists[0].candidateIds.at(-2)
        );
        expect(office?.termEnds).toEqual(new Date(NOW.getTime() + 116 * MS_PER_TURN));
        expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
        expect(await run(db)).toBe(0);
        expect(await db.collection(BG_1991_LIST_REPLACEMENTS_COLLECTION).countDocuments()).toBe(1);
        expect(
          (await db.collection("npps").findOne({ _id: new ObjectId(slot.ownerId) }))?.balance
        ).toBe(777);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("serializes concurrent replacements and advances a later departure", async () => {
    const { db, data, slot } = await fixture();
    try {
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      expect((await Promise.all([run(db), run(db)])).sort()).toEqual([0, 1]);
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      expect(await run(db, 101)).toBe(1);
      expect(
        (await db.collection("electedOfficials").findOne({ _id: stableId(slot.personId) }))
          ?.bulgarianFoundingMandate.personId
      ).toBe(data.nominations.lists[0].candidateIds.at(-1));
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      expect(await run(db, 102)).toBe(0);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      expect(await db.collection(BG_1991_LIST_REPLACEMENTS_COLLECTION).countDocuments()).toBe(2);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["eligible", "pending", "other-office", "different-party", "already-seated"])(
    "handles a%s player while filling two vacancies in one batch",
    async (mode) => {
      const { db, data, slot } = await fixture(),
        playerId = new ObjectId(),
        userId = new ObjectId();
      try {
        const player = data.nominations.people.find(
          (row) => row.id === data.nominations.lists[0].candidateIds.at(-2)
        )!;
        player.ownerId = playerId.toHexString();
        player.candidateId = "player-campaign";
        player.isNpc = false;
        await db
          .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
          .updateOne({ _id: RECEIPT }, { $set: { nominations: data.nominations } });
        await db.collection("characters").insertOne({
          _id: playerId,
          userId,
          countryId: "BG",
          party: mode === "different-party" ? "b" : "a",
          balance: 888,
          currentOffice: mode === "other-office" ? { type: "president" } : null,
          ...(mode === "pending" ? { federationPendingResidenceId: "background" } : {}),
        });
        const slots = data.settled.mandates.filter((row) => row.tier === "list").slice(0, 2);
        await db
          .collection("electedOfficials")
          .deleteMany({ _id: { $in: slots.map((row) => stableId(row.personId)) } });
        if (mode === "already-seated")
          await db
            .collection("electedOfficials")
            .updateOne(
              { _id: stableId(data.settled.mandates[0].personId) },
              { $set: { characterId: playerId, nppId: null } }
            );
        const expected = mode === "eligible" ? 2 : 1;
        expect(await run(db)).toBe(expected);
        expect(
          await db.collection("electedOfficials").countDocuments({ characterId: playerId })
        ).toBe(["eligible", "already-seated"].includes(mode) ? 1 : 0);
        const character = await db.collection("characters").findOne({ _id: playerId });
        expect(character?.balance).toBe(888);
        expect(await db.collection("notifications").countDocuments({ userId })).toBe(
          mode === "eligible" ? 1 : 0
        );
        if (mode === "eligible") {
          expect(character?.careerHistory).toHaveLength(1);
          expect(character?.currentOffice.seatsHeld).toBe(1);
        }
        expect(
          (await db.collection("npps").findOne({ _id: new ObjectId(slot.ownerId) }))?.balance
        ).toBe(777);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("retains the PM mirror and recomputes the departing financial owner's seats", async () => {
    const { db, data, slot } = await fixture();
    try {
      const next = data.nominations.people.find(
          (row) => row.id === data.nominations.lists[0].candidateIds.at(-2)
        )!,
        newId = new ObjectId();
      next.ownerId = newId.toHexString();
      next.candidateId = "pm-campaign";
      await db
        .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
        .updateOne({ _id: RECEIPT }, { $set: { nominations: data.nominations } });
      await db.collection("npps").insertOne({
        _id: newId,
        countryId: "BG",
        party: "a",
        balance: 999,
        currentOffice: { type: "primeMinister" },
      });
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      expect(await run(db)).toBe(1);
      expect((await db.collection("npps").findOne({ _id: newId }))?.currentOffice).toEqual({
        type: "primeMinister",
      });
      expect((await db.collection("npps").findOne({ _id: newId }))?.seatsHeld).toBe(1);
      expect(
        (await db.collection("npps").findOne({ _id: new ObjectId(slot.ownerId) }))?.seatsHeld
      ).toBe(data.settled.mandates.filter((row) => row.ownerId === slot.ownerId).length - 1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("fills an initial certified vacancy without reading frozen ballot payloads", async () => {
    const { db, data, slot } = await fixture();
    try {
      data.settled.mandates = data.settled.mandates.filter((row) => row !== slot);
      data.settled.vacancies.push({
        tier: "list",
        districtId: slot.districtId,
        partyId: slot.partyId,
      });
      await db
        .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
        .updateOne(
          { _id: RECEIPT },
          { $set: { settled: data.settled, first: { unusedBallotPayload: "x".repeat(2_000_000) } } }
        );
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      commands = requestBytes = replyBytes = 0;
      expect(await run(db)).toBe(1);
      expect(replyBytes).toBeLessThan(500_000);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
      expect(
        (await db.collection(BG_1991_LIST_REPLACEMENTS_COLLECTION).findOne({}))?.replacement
      ).toEqual({ slotId: "initial-vacancy:0", personId: slot.personId });
      expect(await run(db)).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["retired", "technocrat"])(
    "leaves the seat vacant when its original financial owner is%s",
    async (mode) => {
      const { db, slot } = await fixture();
      try {
        await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
        await db
          .collection("npps")
          .updateOne(
            { _id: new ObjectId(slot.ownerId) },
            { $set: mode === "retired" ? { retiredAt: NOW } : { isTechnocrat: true } }
          );
        expect(await run(db)).toBe(0);
        expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
        expect(await db.collection("npps").countDocuments()).toBe(5);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("rolls back every office, mirror and notice when journal insertion fails", async () => {
    const { db, data, slot } = await fixture();
    const playerId = new ObjectId(),
      userId = new ObjectId();
    try {
      const person = data.nominations.people.find(
        (row) => row.id === data.nominations.lists[0].candidateIds.at(-2)
      )!;
      person.isNpc = false;
      person.ownerId = playerId.toHexString();
      person.candidateId = "rollback-player";
      await db
        .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
        .updateOne({ _id: RECEIPT }, { $set: { nominations: data.nominations } });
      await db.collection("characters").insertOne({
        _id: playerId,
        userId,
        countryId: "BG",
        party: "a",
        balance: 888,
        currentOffice: null,
        careerHistory: [],
      });
      const beforePlayer = await db.collection("characters").findOne({ _id: playerId });
      await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
      await db.command({
        collMod: BG_1991_LIST_REPLACEMENTS_COLLECTION,
        validator: { _id: { $eq: "reject-every-real-receipt" } },
      });
      const before = await db.collection("npps").find().sort({ _id: 1 }).toArray();
      await expect(run(db)).rejects.toThrow();
      expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      expect(await db.collection("npps").find().sort({ _id: 1 }).toArray()).toEqual(before);
      expect(await db.collection("notifications").countDocuments()).toBe(0);
      expect(await db.collection("characters").findOne({ _id: playerId })).toEqual(beforePlayer);
      expect(
        (await db.collection<Row>(BG_FOUNDING_COUNTS_COLLECTION).findOne({ _id: RECEIPT }))
          ?.listReplacementGeneration
      ).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["ordinary", "dissolved", "expired", "unstamped", "foreign-chamber"])(
    "preserves%s settlements",
    async (mode) => {
      const { db, slot } = await fixture();
      try {
        await db.collection("electedOfficials").deleteOne({ _id: stableId(slot.personId) });
        if (mode === "ordinary")
          await db
            .collection<Row>("countryGameStates")
            .updateOne({ _id: "BG" }, { $set: { bgOrdinaryAssemblySinceTurn: 90 } });
        if (mode === "dissolved")
          await db
            .collection<Row>("countryGameStates")
            .updateOne({ _id: "BG" }, { $set: { dissolvedTurn: 90 } });
        if (mode === "unstamped")
          await db
            .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
            .updateOne({ _id: RECEIPT }, { $unset: { grandTermEndTurn: "" } });
        if (mode === "foreign-chamber")
          await db
            .collection("electedOfficials")
            .updateOne({}, { $unset: { bulgarianFoundingMandate: "" } });
        expect(await run(db, mode === "expired" ? 216 : 100)).toBe(0);
        expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("skips other presets and founding campaigning without any database call", async () => {
    const { db } = await fixture();
    try {
      commands = 0;
      for (const preset of ["1953-default", "1979-default", "2027-default"])
        expect(await advanceBg1991ListVacancies(db, { preset }, 100, NOW)).toBe(0);
      expect(
        await advanceBg1991ListVacancies(
          db,
          { ...GAME, preIteration: { active: true, startedTurn: 0 } },
          100,
          NOW
        )
      ).toBe(0);
      expect(commands).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
});
