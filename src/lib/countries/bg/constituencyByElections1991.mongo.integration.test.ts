/** Grand Assembly partial ballots qualify on an isolated replica set. */
import { createHash } from "node:crypto";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getMongoClient } from "@/lib/mongodb";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { bgListVacancyFixture } from "./listVacancies1991.testFixture";
import { bgRegions1991 } from "./data/bgRegions1991";
import { BG_FOUNDING_COUNTS_COLLECTION } from "./foundingCount1990";
import { registerBgFoundingPlayerFiling } from "./foundingPlayerFiling1990";
import {
  BG_GRAND_BY_ELECTIONS_COLLECTION,
  openBgGrandConstituencyByElections,
  resolveBgGrandConstituencyByElections,
  type BgGrandByElectionRecord,
} from "./constituencyByElections1991";
vi.mock("@/lib/mongodb", () => ({ getMongoClient: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z"),
  GAME = { preset: "1991-default" },
  PARENT = "BG:founding1990:0";
type Row = { _id: string; [key: string]: unknown };
const slotId = (person: string) =>
  new ObjectId(
    createHash("sha256").update(`${PARENT}:person:${person}`).digest("hex").slice(0, 24)
  );
describe.skipIf(!uri)("Bulgarian Grand Assembly partial elections on isolated Mongo", () => {
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
    vi.mocked(getMongoClient).mockResolvedValue(client);
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Writable isolated replica set required");
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture() {
    const db = client.db(`ahd_test_bg_partial_${new ObjectId()}`),
      data = bgListVacancyFixture();
    for (const person of data.nominations.people) person.partyId = "1";
    for (const list of data.nominations.lists) list.partyId = "1";
    for (const mandate of data.settled.mandates) mandate.partyId = "1";
    data.settled.partySeats = { "1": 400 };
    for (const name of [
      "gameState",
      "countryGameStates",
      "governmentFormations",
      BG_FOUNDING_COUNTS_COLLECTION,
      BG_GRAND_BY_ELECTIONS_COLLECTION,
      "electedOfficials",
      "npps",
      "characters",
      "politicalParties",
      "elections",
      "electionCandidates",
      "electionVoteTallies",
      "campaigns",
      "notifications",
      "bgFoundingAssemblyFilingLocks",
      "bgFoundingAssemblyOfficeArchives",
    ])
      await db.createCollection(name);
    await db.collection<Row>("gameState").insertOne({ _id: "current", ...GAME, currentTurn: 100 });
    await db.collection<Row>("countryGameStates").insertOne({ _id: "BG" });
    await db
      .collection<Row>("governmentFormations")
      .insertOne({ _id: "BG", totalSeats: 400, majorityThreshold: 201, status: "formed" });
    await db.collection<Row>(BG_FOUNDING_COUNTS_COLLECTION).insertOne({
      _id: PARENT,
      countryId: "BG",
      cycle: 0,
      seatedAtTurn: 0,
      grandTermEndTurn: 216,
      nominations: data.nominations,
      settled: data.settled,
    });
    await db.collection<Row>("states").insertMany(
      bgRegions1991.map((row) => ({
        ...row,
        population: 1_000_000,
        votingEligiblePopulation: 800_000,
      }))
    );
    await db.collection("npps").insertMany(
      [...data.ownerIds].map(([state, id]) => ({
        _id: new ObjectId(id),
        countryId: "BG",
        homeState: state,
        name: "Filed financial actor",
        party: "1",
        balance: 777,
        seatsHeld: data.settled.mandates.filter((row) => row.ownerId === id).length,
        currentOffice: {
          type: "assemblyDeputy",
          state,
          seatsHeld: data.settled.mandates.filter((row) => row.ownerId === id).length,
        },
      }))
    );
    await db.collection("politicalParties").insertMany(
      [1, 2].map((sequentialId) => ({
        countryId: "BG",
        sequentialId,
        name: `Filed party ${sequentialId}`,
      }))
    );
    await db.collection("electedOfficials").insertMany(
      data.settled.mandates.map((row) => ({
        _id: slotId(row.personId),
        countryId: "BG",
        officeType: "assemblyDeputy",
        nppId: new ObjectId(row.ownerId),
        characterId: null,
        seatsHeld: 1,
        state: row.regionId,
        party: "1",
        termEnds: new Date(NOW.getTime() + 116 * MS_PER_TURN),
        bulgarianFoundingMandate: {
          receiptId: PARENT,
          personId: row.personId,
          tier: row.tier,
          districtId: row.districtId,
          rootCandidateId: row.candidateId,
        },
      }))
    );
    return { db, data, slot: data.settled.mandates[0] };
  }
  async function vacant(db: Db, person: string) {
    await db.collection("electedOfficials").deleteOne({ _id: slotId(person) });
  }
  async function job(db: Db) {
    const row = await db
      .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
      .findOne({ status: "open" });
    if (!row) throw new Error("Missing partial-election receipt");
    return row;
  }
  async function vote(db: Db, record: BgGrandByElectionRecord, shares: Record<string, number>) {
    const candidates = await db
      .collection("electionCandidates")
      .find({ electionId: record.activeElectionId })
      .toArray();
    await db
      .collection("elections")
      .updateOne({ _id: record.activeElectionId }, { $set: { status: "completed" } });
    await db.collection("electionVoteTallies").updateOne(
      { electionId: record.activeElectionId },
      {
        $set: {
          totalVotes: Object.fromEntries(
            candidates.map((row) => [
              row._id.toHexString(),
              Math.floor(record.registeredVoters * (shares[row.party] ?? 0)),
            ])
          ),
          candidateParties: Object.fromEntries(
            candidates.map((row) => [row._id.toHexString(), row.party])
          ),
          candidateNames: Object.fromEntries(
            candidates.map((row) => [row._id.toHexString(), row.characterName])
          ),
        },
      }
    );
  }
  async function player(db: Db, region: string, party = "2") {
    const id = new ObjectId(),
      userId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: id,
      userId,
      countryId: "BG",
      homeState: region,
      party,
      balance: 888,
      currentOffice: null,
      careerHistory: [],
    });
    return { id, userId, party };
  }
  async function file(
    db: Db,
    record: BgGrandByElectionRecord,
    actor: { id: ObjectId; party: string },
    turn = 100,
    districtId = record.districtId
  ) {
    return registerBgFoundingPlayerFiling({
      db,
      electionId: record.activeElectionId,
      requestedDistrictId: districtId,
      turn,
      now: NOW,
      candidate: {
        electionId: record.activeElectionId,
        countryId: "BG",
        characterId: actor.id,
        party: actor.party,
        isNPP: false,
        characterName: "Filed player",
        status: "active",
        enteredAt: NOW,
      },
    });
  }
  it("uses four compact reads and no writes for an intact chamber", async () => {
    const { db } = await fixture();
    try {
      commands = requestBytes = replyBytes = 0;
      expect(await openBgGrandConstituencyByElections(db, GAME, 100, NOW)).toBe(0);
      process.stdout.write(
        JSON.stringify({ path: "partial-intact", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBe(4);
      expect(replyBytes).toBeLessThan(2000);
    } finally {
      await db.dropDatabase();
    }
  });
  it("opens, counts and seats one physical constituency while leaving all200 list mandates intact", async () => {
    const { db, slot } = await fixture();
    try {
      const lists = await db
        .collection("electedOfficials")
        .find({ "bulgarianFoundingMandate.tier": "list" })
        .sort({ _id: 1 })
        .toArray();
      await vacant(db, slot.personId);
      commands = requestBytes = replyBytes = 0;
      expect(await openBgGrandConstituencyByElections(db, GAME, 100, NOW)).toBe(1);
      process.stdout.write(
        JSON.stringify({ path: "partial-open", commands, requestBytes, replyBytes }) + "\n"
      );
      const record = await job(db),
        poll = await db.collection("elections").findOne({ _id: record.activeElectionId });
      expect(poll).toMatchObject({
        totalSeats: 1,
        startTurn: 100,
        primaryEndTurn: 101,
        endTurn: 104,
      });
      expect(await openBgGrandConstituencyByElections(db, GAME, 100, NOW)).toBe(0);
      await vote(db, record, { "1": 0.8 });
      commands = requestBytes = replyBytes = 0;
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(1);
      process.stdout.write(
        JSON.stringify({ path: "partial-seat", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
      expect(
        await db
          .collection("electedOfficials")
          .find({ "bulgarianFoundingMandate.tier": "list" })
          .sort({ _id: 1 })
          .toArray()
      ).toEqual(lists);
      expect(
        (await db.collection("electedOfficials").findOne({ _id: slotId(slot.personId) }))?.termEnds
      ).toEqual(new Date(NOW.getTime() + 116 * MS_PER_TURN));
      expect(await db.collection("npps").countDocuments()).toBe(5);
      expect(
        (await db.collection("npps").findOne({ _id: new ObjectId(slot.ownerId) }))?.balance
      ).toBe(777);
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it("seats a player after a real majority and updates both financial-owner mirrors and one notice", async () => {
    const { db, slot, data } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const record = await job(db),
        actor = await player(db, slot.regionId);
      expect((await file(db, record, actor)).allowed).toBe(true);
      await vote(db, record, { "1": 0.2, "2": 0.6 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(1);
      const character = await db.collection("characters").findOne({ _id: actor.id });
      expect(character?.balance).toBe(888);
      expect(character?.currentOffice).toMatchObject({ type: "assemblyDeputy", seatsHeld: 1 });
      expect(character?.careerHistory).toHaveLength(1);
      expect(await db.collection("notifications").countDocuments({ userId: actor.userId })).toBe(1);
      expect(
        (await db.collection("npps").findOne({ _id: new ObjectId(slot.ownerId) }))?.seatsHeld
      ).toBe(data.settled.mandates.filter((row) => row.ownerId === slot.ownerId).length - 1);
      expect(
        await db.collection("electedOfficials").countDocuments({ characterId: actor.id })
      ).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("opens the top-two runoff within one week and seats its low-turnout plurality", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const first = await job(db),
        actor = await player(db, slot.regionId);
      expect((await file(db, first, actor)).allowed).toBe(true);
      await db.collection("campaigns").insertOne({
        electionId: first.activeElectionId,
        candidateId: actor.id,
        status: "active",
        funds: 500,
      });
      await vote(db, first, { "1": 0.3, "2": 0.3 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(0);
      const second = await job(db);
      expect(second.round).toBe(2);
      expect(second.first?.options).toHaveLength(2);
      expect(
        (await db.collection("elections").findOne({ _id: second.activeElectionId }))?.endTurn
      ).toBe(105);
      expect((await db.collection("campaigns").findOne({ candidateId: actor.id }))?.funds).toBe(
        500
      );
      expect(
        (await db.collection("campaigns").findOne({ candidateId: actor.id }))?.electionId
      ).toEqual(second.activeElectionId);
      await vote(db, second, { "1": 0.1, "2": 0.2 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 105, NOW)).toBe(2);
      expect(
        await db.collection("electedOfficials").countDocuments({ characterId: actor.id })
      ).toBe(1);
      expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
        2
      );
    } finally {
      await db.dropDatabase();
    }
  });
  it("allows new nominations after a sole candidate fails and keeps the first ballot frozen", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const first = await job(db);
      await vote(db, first, { "1": 0.3 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(0);
      const second = await job(db),
        actor = await player(db, slot.regionId);
      expect((await file(db, second, actor, 104)).allowed).toBe(true);
      await vote(db, second, { "1": 0.1, "2": 0.2 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 105, NOW)).toBe(2);
      expect(
        (
          await db
            .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
            .findOne({ _id: first._id })
        )?.first
      ).toEqual(second.first);
      expect(
        await db.collection("electedOfficials").countDocuments({ characterId: actor.id })
      ).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("serializes concurrent opening without duplicate polls or financial actors", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      expect(
        (
          await Promise.all([
            openBgGrandConstituencyByElections(db, GAME, 100, NOW),
            openBgGrandConstituencyByElections(db, GAME, 100, NOW),
          ])
        ).sort()
      ).toEqual([0, 1]);
      expect(await db.collection("elections").countDocuments()).toBe(1);
      expect(await db.collection("npps").countDocuments()).toBe(5);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["outside-district", "pending", "held-seat", "late", "caretaker"])(
    "rejects%s player filing without a reservation or candidacy",
    async (mode) => {
      const { db, slot } = await fixture();
      try {
        await vacant(db, slot.personId);
        await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
        const record = await job(db),
          actor = await player(db, slot.regionId);
        if (mode === "pending")
          await db
            .collection("characters")
            .updateOne({ _id: actor.id }, { $set: { federationPendingResidenceId: "background" } });
        if (mode === "held-seat")
          await db
            .collection("electedOfficials")
            .updateOne({}, { $set: { characterId: actor.id, nppId: null } });
        if (mode === "caretaker")
          await db
            .collection<Row>("countryGameStates")
            .updateOne({ _id: "BG" }, { $set: { bgGrandAssemblyDissolutionSinceTurn: 101 } });
        expect(
          (
            await file(
              db,
              record,
              actor,
              mode === "late" ? 101 : 100,
              mode === "outside-district" ? "foreign" : record.districtId
            )
          ).allowed
        ).toBe(false);
        expect(
          await db
            .collection("electionCandidates")
            .countDocuments({ characterId: actor.id, isNPP: false })
        ).toBe(0);
        expect(await db.collection("bgFoundingAssemblyFilingLocks").countDocuments()).toBe(0);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each(["ordinary", "caretaker", "federation", "expired"])(
    "cancels%s pending ballots and preserves the remaining chamber",
    async (mode) => {
      const { db, slot } = await fixture();
      try {
        await vacant(db, slot.personId);
        await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
        if (mode !== "expired")
          await db.collection<Row>("countryGameStates").updateOne(
            { _id: "BG" },
            {
              $set:
                mode === "ordinary"
                  ? { bgOrdinaryAssemblySinceTurn: 102 }
                  : mode === "federation"
                    ? { dissolvedTurn: 102 }
                    : { bgGrandAssemblyDissolutionSinceTurn: 102 },
            }
          );
        expect(
          await openBgGrandConstituencyByElections(db, GAME, mode === "expired" ? 216 : 102, NOW)
        ).toBe(0);
        expect(
          await db
            .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
            .countDocuments({ status: "open" })
        ).toBe(0);
        expect(await db.collection("elections").countDocuments({ status: "cancelled" })).toBe(1);
        expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("schedules before the last-six-month cutoff and still counts the later poll", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      expect(await openBgGrandConstituencyByElections(db, GAME, 191, NOW)).toBe(1);
      const record = await job(db);
      await vote(db, record, { "1": 0.8 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 195, NOW)).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("does not newly schedule in the last six months", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      expect(await openBgGrandConstituencyByElections(db, GAME, 192, NOW)).toBe(0);
      expect(await db.collection("elections").countDocuments()).toBe(0);
    } finally {
      await db.dropDatabase();
    }
  });
  it("seats concurrent resolvers only once", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      await vote(db, await job(db), { "1": 0.8 });
      const counts = await Promise.all([
        resolveBgGrandConstituencyByElections(db, GAME, 104, NOW),
        resolveBgGrandConstituencyByElections(db, GAME, 104, NOW),
      ]);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
      expect(
        await db.collection(BG_GRAND_BY_ELECTIONS_COLLECTION).countDocuments({ status: "seated" })
      ).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("bounds database commands for 25 simultaneous constituency vacancies", async () => {
    const { db, data } = await fixture();
    try {
      const slots = data.settled.mandates.filter((row) => row.tier === "constituency").slice(0, 25);
      expect(slots).toHaveLength(25);
      await db
        .collection("electedOfficials")
        .deleteMany({ _id: { $in: slots.map((row) => slotId(row.personId)) } });
      commands = requestBytes = replyBytes = 0;
      expect(await openBgGrandConstituencyByElections(db, GAME, 100, NOW)).toBe(25);
      process.stdout.write(
        JSON.stringify({ path: "partial-open-25", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBeLessThanOrEqual(25);
      const records = await db
        .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
        .find({ status: "open" })
        .toArray();
      for (const record of records) await vote(db, record, { "1": 0.8 });
      commands = requestBytes = replyBytes = 0;
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(25);
      process.stdout.write(
        JSON.stringify({ path: "partial-seat-25", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBeLessThanOrEqual(25);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
      expect(await db.collection("npps").countDocuments()).toBe(5);
    } finally {
      await db.dropDatabase();
    }
  });
  it("rolls back every opening write after a late tally validation failure", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      const country = await db.collection<Row>("countryGameStates").findOne({ _id: "BG" });
      await db.command({
        collMod: "electionVoteTallies",
        validator: { impossible: { $exists: true } },
      });
      await expect(openBgGrandConstituencyByElections(db, GAME, 100, NOW)).rejects.toThrow();
      expect(await db.collection("elections").countDocuments()).toBe(0);
      expect(await db.collection("electionCandidates").countDocuments()).toBe(0);
      expect(await db.collection(BG_GRAND_BY_ELECTIONS_COLLECTION).countDocuments()).toBe(0);
      expect(await db.collection<Row>("countryGameStates").findOne({ _id: "BG" })).toEqual(country);
    } finally {
      await db.dropDatabase();
    }
  });
  it("lets one player concurrently file for only one of two vacant constituencies", async () => {
    const { db, data, slot } = await fixture();
    try {
      const slots = data.settled.mandates
        .filter((row) => row.tier === "constituency" && row.regionId === slot.regionId)
        .slice(0, 2);
      expect(slots).toHaveLength(2);
      await db
        .collection("electedOfficials")
        .deleteMany({ _id: { $in: slots.map((row) => slotId(row.personId)) } });
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const records = await db
        .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
        .find({ status: "open" })
        .toArray();
      const actor = await player(db, slot.regionId);
      const results = await Promise.all(records.map((record) => file(db, record, actor)));
      expect(results.filter((result) => result.allowed)).toHaveLength(1);
      expect(
        await db
          .collection("electionCandidates")
          .countDocuments({ characterId: actor.id, status: "active" })
      ).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("reconciles a departed pending-relocation player after the next constituency winner", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const actor = await player(db, slot.regionId),
        first = await job(db);
      expect((await file(db, first, actor)).allowed).toBe(true);
      await vote(db, first, { "1": 0.2, "2": 0.6 });
      await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW);
      await vacant(db, slot.personId);
      await db
        .collection("characters")
        .updateOne(
          { _id: actor.id },
          { $set: { federationPendingResidenceId: "background-successor" } }
        );
      await openBgGrandConstituencyByElections(db, GAME, 105, NOW);
      const second = await job(db);
      expect(second.previousOwnerId).toBe(actor.id.toHexString());
      expect(second.previousIsNpc).toBe(false);
      await vote(db, second, { "1": 0.8 });
      expect(await resolveBgGrandConstituencyByElections(db, GAME, 109, NOW)).toBe(1);
      const departed = await db.collection("characters").findOne({ _id: actor.id });
      expect(departed?.currentOffice).toBeNull();
      expect(departed?.federationPendingResidenceId).toBe("background-successor");
      expect(departed?.balance).toBe(888);
      expect(departed?.careerHistory).toHaveLength(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["retired", "party", "pending"])(
    "leaves the seat vacant when the winning owner's %s eligibility changes",
    async (mode) => {
      const { db, slot } = await fixture();
      try {
        await vacant(db, slot.personId);
        await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
        const record = await job(db);
        if (mode === "pending") {
          const actor = await player(db, slot.regionId);
          expect((await file(db, record, actor)).allowed).toBe(true);
          await vote(db, record, { "1": 0.2, "2": 0.6 });
          await db
            .collection("characters")
            .updateOne(
              { _id: actor.id },
              { $set: { federationPendingResidenceId: "background-successor" } }
            );
        } else {
          await vote(db, record, { "1": 0.8 });
          const nominee = await db
            .collection("electionCandidates")
            .findOne({ electionId: record.activeElectionId, isNPP: true });
          await db
            .collection("npps")
            .updateOne(
              { _id: nominee!.nppId },
              { $set: mode === "retired" ? { retiredAt: NOW } : { party: "2" } }
            );
        }
        expect(await resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).toBe(1);
        expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
        expect(
          await db.collection(BG_GRAND_BY_ELECTIONS_COLLECTION).countDocuments({ status: "vacant" })
        ).toBe(1);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("rejects a changed ballot binding without any seating writes", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const record = await job(db);
      await vote(db, record, { "1": 0.8 });
      await db
        .collection("elections")
        .updateOne(
          { _id: record.activeElectionId },
          { $set: { "bulgarianFoundingRound.byElection.generation": 999 } }
        );
      await expect(resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).rejects.toThrow(
        "binding changed"
      );
      expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
        0
      );
    } finally {
      await db.dropDatabase();
    }
  });
  it("rolls back a late seating receipt failure, including the player's office, notice and mirrors", async () => {
    const { db, slot } = await fixture();
    try {
      await vacant(db, slot.personId);
      await openBgGrandConstituencyByElections(db, GAME, 100, NOW);
      const record = await job(db),
        actor = await player(db, slot.regionId);
      expect((await file(db, record, actor)).allowed).toBe(true);
      await vote(db, record, { "1": 0.2, "2": 0.6 });
      const before = await db.collection("characters").findOne({ _id: actor.id });
      await db.command({
        collMod: BG_GRAND_BY_ELECTIONS_COLLECTION,
        validator: { status: { $eq: "open" } },
      });
      await expect(resolveBgGrandConstituencyByElections(db, GAME, 104, NOW)).rejects.toThrow();
      expect(await db.collection("characters").findOne({ _id: actor.id })).toEqual(before);
      expect(await db.collection("notifications").countDocuments()).toBe(0);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(399);
      expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
        0
      );
    } finally {
      await db.dropDatabase();
    }
  });
});
