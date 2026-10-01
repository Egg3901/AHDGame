import { MongoClient, ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Election } from "@/lib/db/types";
import { openRussianDumaElection } from "./dumaElectionOpening";
import { certifyRussianDumaElection, RUSSIAN_DUMA_RESULTS_COLLECTION } from "./dumaElectionResult";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
type Fixture = { _id: string | ObjectId; [key: string]: unknown };
describe.skipIf(!uri)("First Duma on an isolated Mongo replica set", () => {
  let client: MongoClient;
  let databaseName: string;
  let commands = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Duma qualification accepts an explicit loopback test database only");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
    client.on("commandStarted", () => {
      commands += 1;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Duma qualification needs a writable replica-set primary");
  });
  beforeEach(async () => {
    databaseName = `ahd_test_duma_${new ObjectId().toHexString()}`;
    await client
      .db(databaseName)
      .collection<Fixture>("gameState")
      .insertOne({ _id: "current", preset: "1991-default" });
  });
  afterEach(async () => {
    await client.db(databaseName).dropDatabase();
  });
  afterAll(async () => {
    await client?.close();
  });
  it("rolls back a partially inserted first Duma cohort, then retries and replays in bounded commands", async () => {
    const db = client.db(databaseName);
    await db.collection<Fixture>("countryGameStates").insertOne({
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
    });
    await db.collection<Fixture>("states").insertMany(
      Object.entries(RU_1991_ECONOMIC_REGION_POPULATION).map(([id, population]) => ({
        _id: id,
        countryId: "RU",
        population,
        votingEligiblePopulation: population * 0.7,
      }))
    );
    await db.createCollection("elections", {
      validator: { seatId: { $ne: "RU-duma-national-list" } },
    });
    const officialId = new ObjectId();
    await db
      .collection("electedOfficials")
      .insertOne({ _id: officialId, countryId: "RU", officeType: "congressDeputy" });
    const input = { db, game: { preset: "1991-default" }, turn: 129, now: new Date(1000) };
    await expect(openRussianDumaElection(input)).rejects.toThrow();
    expect(await db.collection("elections").countDocuments()).toBe(0);
    expect(
      await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
    ).not.toHaveProperty("ruFirstDumaElectionCohortId");
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    await db.command({ collMod: "elections", validator: {} });
    commands = 0;
    const result = await openRussianDumaElection(input);
    const openingCommands = commands;
    expect(result?.created).toBe(true);
    expect(openingCommands).toBeLessThanOrEqual(9);
    expect(await db.collection("elections").countDocuments()).toBe(226);
    commands = 0;
    const replay = await openRussianDumaElection({ ...input, turn: 130 });
    const replayCommands = commands;
    expect(replay?.created).toBe(false);
    expect(replay?.cohortId.equals(result!.cohortId)).toBe(true);
    expect(replayCommands).toBeLessThanOrEqual(6);
    expect(await db.collection("elections").countDocuments()).toBe(226);
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    console.info("Russian Duma opening qualification", {
      openingCommands,
      replayCommands,
      ballots: 226,
    });
  });

  it("rolls back all 226 Duma certifications on a late journal failure, then retries and replays", async () => {
    const db = client.db(databaseName);
    await db.collection<Fixture>("countryGameStates").insertOne({
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
    });
    await db.collection<Fixture>("states").insertMany(
      Object.entries(RU_1991_ECONOMIC_REGION_POPULATION).map(([id, population]) => ({
        _id: id,
        countryId: "RU",
        population,
        votingEligiblePopulation: population * 0.7,
      }))
    );
    const opened = await openRussianDumaElection({
      db,
      game: { preset: "1991-default" },
      turn: 129,
      now: new Date(1000),
    });
    const elections = await db
      .collection<Election>("elections")
      .find({ countryId: "RU" })
      .toArray();
    const npcId = new ObjectId();
    const officialId = new ObjectId();
    await db.collection("npps").insertOne({ _id: npcId, countryId: "RU", party: "1" });
    await db
      .collection("electedOfficials")
      .insertOne({ _id: officialId, countryId: "RU", officeType: "congressDeputy" });
    const candidates = elections.map((row) => ({
      _id: new ObjectId(),
      electionId: row._id,
      countryId: "RU",
      characterId: new ObjectId(),
      nppId: npcId,
      isNPP: true,
      party: "1",
      characterName: "Bounded nominee",
      status: "active",
      russianDumaNomination: {
        registrationOrder: 0,
        nominationOrder: 0,
        capacity: row.totalSeats!,
      },
    }));
    await db.collection("electionCandidates").insertMany(candidates);
    const withdrawn: Fixture = { ...candidates[0], _id: new ObjectId(), status: "withdrawn" };
    delete withdrawn.russianDumaNomination;
    await db.collection<Fixture>("electionCandidates").insertOne(withdrawn);
    await db
      .collection("electionCandidates")
      .updateOne({ _id: candidates[1]._id }, { $set: { status: "withdrawn" } });

    await db.collection("electionVoteTallies").insertMany(
      elections.map((row, index) => ({
        _id: new ObjectId(),
        electionId: row._id,
        finalized: false,
        totalVotes: {
          [candidates[index]._id.toHexString()]: row.russianDumaRound!.registeredVoters,
        },
        candidateParties: { [candidates[index]._id.toHexString()]: "1" },
        russianDumaBallot: { againstAllVotes: 0 },
      }))
    );
    await db
      .collection("elections")
      .updateMany({ countryId: "RU" }, { $set: { status: "completed" } });
    await db.createCollection(RUSSIAN_DUMA_RESULTS_COLLECTION, {
      validator: { countryId: { $ne: "RU" } },
    });
    const input = { db, cohortId: opened!.cohortId, turn: 141, now: new Date(2000) };
    await expect(certifyRussianDumaElection(input)).rejects.toThrow();
    expect(
      await db.collection("elections").countDocuments({ countryId: "RU", status: "completed" })
    ).toBe(226);
    expect(await db.collection("electionVoteTallies").countDocuments({ finalized: false })).toBe(
      226
    );
    expect(
      await db
        .collection("electionVoteTallies")
        .countDocuments({ "russianDumaBallot.certifiedCohortId": { $exists: true } })
    ).toBe(0);
    expect(await db.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).countDocuments()).toBe(0);
    expect(await db.collection("electionCandidates").countDocuments({ status: "active" })).toBe(
      225
    );
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    await db.command({ collMod: RUSSIAN_DUMA_RESULTS_COLLECTION, validator: {} });
    commands = 0;
    const result = await certifyRussianDumaElection(input);
    const certificationCommands = commands;
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(result.nominees).toHaveLength(226);
    expect(await db.collection("electionCandidates").countDocuments({ status: "active" })).toBe(0);
    expect(result.nominees.some((row) => row.candidateId.equals(withdrawn._id))).toBe(false);
    expect(
      Object.values(result.votesByElection[elections[1]._id.toHexString()].votes)[0]
    ).toBeGreaterThan(0);
    expect(result.result.listDecision.outcome).toBe("elected");
    expect(certificationCommands).toBeLessThanOrEqual(18);
    expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
      226
    );
    expect(
      await db.collection("elections").countDocuments({ countryId: "RU", status: "resolved" })
    ).toBe(226);
    expect(
      await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
    ).not.toHaveProperty("ruFederalAssemblyElectionCertifiedSinceTurn");
    commands = 0;
    expect(await certifyRussianDumaElection({ ...input, turn: 142 })).toEqual(result);
    const replayCommands = commands;
    expect(replayCommands).toBeLessThanOrEqual(3);
    expect(await db.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).countDocuments()).toBe(1);
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    console.info("Russian Duma certification qualification", {
      certificationCommands,
      replayCommands,
      ballots: 226,
    });
  });
});
