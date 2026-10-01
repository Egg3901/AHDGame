import { MongoClient, ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Election } from "@/lib/db/types";
import { admitRussianDumaNpcNominees } from "./dumaNpcAdmission";
import { certifyRussianDumaRepeat } from "./dumaRepeatResult";
import {
  openRussianDumaRepeat,
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
} from "./dumaRepeatOpening";
import { openRussianDumaElection } from "./dumaElectionOpening";
import {
  certifyRussianDumaElection,
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
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

  it("atomically opens only failed ballots with fresh registers and replays the immutable generation", async () => {
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
      characterId: npcId,
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
    // A district and the national list fail. Every other district remains valid.
    const failedIds = new Set([
      elections[0]._id.toHexString(),
      elections.find((row) => row.totalSeats === 225)!._id.toHexString(),
    ]);
    await db.collection("electionVoteTallies").insertMany(
      elections.map((row, index) => ({
        _id: new ObjectId(),
        electionId: row._id,
        finalized: false,
        totalVotes: {
          [candidates[index]._id.toHexString()]: failedIds.has(row._id.toHexString())
            ? 0
            : row.russianDumaRound!.registeredVoters,
        },
        candidateParties: { [candidates[index]._id.toHexString()]: "1" },
        russianDumaBallot: { againstAllVotes: 0 },
      }))
    );
    await db.collection("elections").updateMany({}, { $set: { status: "completed" } });
    const previous = await certifyRussianDumaElection({
      db,
      cohortId: opened!.cohortId,
      turn: 141,
      now: new Date(2000),
    });
    const snapshot = structuredClone(previous.ballots);
    await db.collection("states").updateMany({}, { $mul: { votingEligiblePopulation: 0.5 } });
    await db.createCollection(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION, {
      validator: { generation: { $ne: 1 } },
    });
    const input = {
      db,
      rootCohortId: opened!.cohortId,
      previousResultId: previous._id,
      turn: 142,
      now: new Date(3000),
    };
    await expect(openRussianDumaRepeat(input)).rejects.toMatchObject({ code: 121 });
    expect(await db.collection("elections").countDocuments()).toBe(226);
    expect(await db.collection(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION).countDocuments()).toBe(0);
    await db.command({ collMod: RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION, validator: {} });
    commands = 0;
    const result = await openRussianDumaRepeat(input);
    const openingCommands = commands;
    expect(result?.created).toBe(true);
    expect(result?.record.generation).toBe(1);
    expect(result?.record.electionIds).toHaveLength(2);
    expect(openingCommands).toBeLessThanOrEqual(11);
    const replacements = await db
      .collection<Election>("elections")
      .find({ "russianDumaRound.cohortId": result!.record.cohortId })
      .toArray();
    expect(replacements).toHaveLength(2);
    expect(
      new Set(replacements.map((row) => row.russianDumaRound!.predecessorElectionId!.toHexString()))
    ).toEqual(failedIds);
    for (const row of replacements) {
      const old = previous.ballots!.find((ballot) => ballot.seatId === row.seatId)!;
      expect(row.russianDumaRound!.registeredVoters).toBeLessThan(old.registeredVoters);
      expect(row.russianDumaRound!.rootCohortId?.equals(opened!.cohortId)).toBe(true);
      expect(row.startTurn).toBe(142);
      expect(row.primaryEndTurn).toBe(152);
      expect(row.endTurn).toBe(154);
    }
    commands = 0;
    const replay = await openRussianDumaRepeat({ ...input, turn: 143 });
    const replayCommands = commands;
    expect(replay?.created).toBe(false);
    expect(replay?.record).toEqual(result!.record);
    expect(replayCommands).toBeLessThanOrEqual(6);
    expect(await db.collection("elections").countDocuments()).toBe(228);
    expect(
      (
        await db
          .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
          .findOne({ _id: previous._id })
      )?.ballots
    ).toEqual(snapshot);
    expect(
      await db
        .collection("elections")
        .countDocuments({ "russianDumaRound.cohortId": opened!.cohortId, status: "resolved" })
    ).toBe(226);
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    expect(
      await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
    ).not.toHaveProperty("ruFederalAssemblySinceTurn");
    const repeatCandidates = replacements.map((row) => ({
      _id: new ObjectId(),
      electionId: row._id,
      countryId: "RU",
      characterId: npcId,
      nppId: npcId,
      isNPP: true,
      party: "1",
      characterName: "Repeat bounded nominee",
      status: "active",
      russianDumaNomination: {
        registrationOrder: 3000,
        nominationOrder: 0,
        capacity: row.totalSeats!,
      },
    }));
    await db.collection("electionCandidates").insertMany(repeatCandidates);
    await db.collection("electionVoteTallies").insertMany(
      replacements.map((row, index) => ({
        _id: new ObjectId(),
        electionId: row._id,
        finalized: false,
        totalVotes: {
          [repeatCandidates[index]._id.toHexString()]:
            row.totalSeats === 225 ? row.russianDumaRound!.registeredVoters : 0,
        },
        candidateParties: { [repeatCandidates[index]._id.toHexString()]: "1" },
        russianDumaBallot: { againstAllVotes: 0 },
      }))
    );
    await db
      .collection("elections")
      .updateMany(
        { "russianDumaRound.cohortId": result!.record.cohortId },
        { $set: { status: "completed" } }
      );
    await db.command({
      collMod: RUSSIAN_DUMA_RESULTS_COLLECTION,
      validator: { generation: { $ne: 1 } },
    });
    const certification = {
      db,
      rootCohortId: opened!.cohortId,
      generation: 1,
      turn: 154,
      now: new Date(4000),
    };
    await expect(certifyRussianDumaRepeat(certification)).rejects.toMatchObject({ code: 121 });
    expect(
      await db.collection("elections").countDocuments({
        "russianDumaRound.cohortId": result!.record.cohortId,
        status: "completed",
      })
    ).toBe(2);
    expect(
      await db
        .collection("electionVoteTallies")
        .countDocuments({ electionId: { $in: result!.record.electionIds }, finalized: false })
    ).toBe(2);
    expect(
      await db
        .collection("electionCandidates")
        .countDocuments({ electionId: { $in: result!.record.electionIds }, status: "active" })
    ).toBe(2);
    expect(await db.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).countDocuments()).toBe(1);
    await db.command({ collMod: RUSSIAN_DUMA_RESULTS_COLLECTION, validator: {} });
    commands = 0;
    const firstRepeat = await certifyRussianDumaRepeat(certification);
    const certificationCommands = commands;
    expect(certificationCommands).toBeLessThanOrEqual(18);
    expect(firstRepeat.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(firstRepeat.result.listDecision.outcome).toBe("elected");
    expect(firstRepeat.ballots).toHaveLength(226);
    expect(firstRepeat.nominees).toHaveLength(226);
    expect(Object.keys(firstRepeat.votesByElection)).toHaveLength(226);
    expect(firstRepeat.result.constituencyResults.filter((row) => row.winner)).toEqual(
      previous.result.constituencyResults.filter((row) => row.winner)
    );
    commands = 0;
    expect(await certifyRussianDumaRepeat({ ...certification, turn: 155 })).toEqual(firstRepeat);
    expect(commands).toBeLessThanOrEqual(3);
    const next = await openRussianDumaRepeat({
      ...input,
      previousResultId: firstRepeat._id,
      turn: 155,
      now: new Date(5000),
    });
    expect(next?.record.generation).toBe(2);
    expect(next?.record.electionIds).toHaveLength(1);
    const last = await db
      .collection<Election>("elections")
      .findOne({ _id: next!.record.electionIds[0] });
    const lastCandidate = {
      ...repeatCandidates.find((row) =>
        row.electionId.equals(replacements.find((row) => row.totalSeats === 1)!._id)
      )!,
      _id: new ObjectId(),
      electionId: last!._id,
      status: "active",
    };
    await db.collection("electionCandidates").insertOne(lastCandidate);
    await db.collection("electionVoteTallies").insertOne({
      _id: new ObjectId(),
      electionId: last!._id,
      finalized: false,
      totalVotes: { [lastCandidate._id.toHexString()]: last!.russianDumaRound!.registeredVoters },
      candidateParties: { [lastCandidate._id.toHexString()]: "1" },
      russianDumaBallot: { againstAllVotes: 0 },
    });
    await db
      .collection("elections")
      .updateOne({ _id: last!._id }, { $set: { status: "completed" } });
    const finalRepeat = await certifyRussianDumaRepeat({
      ...certification,
      generation: 2,
      turn: 167,
      now: new Date(6000),
    });
    expect(finalRepeat.result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(
      Object.values(finalRepeat.result.listAssignment!.seatsByNominee).reduce(
        (sum, seats) => sum + seats,
        0
      )
    ).toBe(225);
    expect(finalRepeat.result.listDecision.outcome).toBe("elected");
    expect(
      await openRussianDumaRepeat({ ...input, previousResultId: finalRepeat._id, turn: 168 })
    ).toBeNull();
    expect(await db.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).countDocuments()).toBe(3);
    expect(await db.collection("electedOfficials").findOne({ _id: officialId })).not.toBeNull();
    expect(
      (
        await db
          .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
          .findOne({ _id: previous._id })
      )?.ballots
    ).toEqual(snapshot);
    await db
      .collection<Fixture>("countryGameStates")
      .updateOne({ _id: "RU" }, { $set: { ruFederalAssemblyMandateSinceTurn: 130 } });
    await expect(openRussianDumaRepeat(input)).rejects.toThrow("unseated certified predecessor");
    await db
      .collection<Fixture>("countryGameStates")
      .updateOne({ _id: "RU" }, { $set: { ruFederalAssemblyMandateSinceTurn: 129 } });
    await db
      .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
      .updateOne({ _id: previous._id }, { $unset: { ballots: "" } });
    await expect(openRussianDumaRepeat(input)).rejects.toThrow("preserved predecessor ballots");
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
    await expect(certifyRussianDumaElection(input)).rejects.toMatchObject({ code: 121 });
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
    expect(result.ballots).toHaveLength(226);
    const countedWithdrawal = result.ballots!.find(
      (row) => row.id === elections[1]._id.toHexString()
    )!;
    expect(countedWithdrawal.candidates[0]).toMatchObject({
      id: candidates[1]._id.toHexString(),
      party: "1",
      eligible: false,
      registrationOrder: 0,
      nominationOrder: 0,
      capacity: 1,
    });
    expect(countedWithdrawal.candidates[0].votes).toBeGreaterThan(0);
    const snapshot = await db
      .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
      .findOne({ _id: opened!.cohortId.toHexString() });
    expect(snapshot?.ballots).toEqual(result.ballots);

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
    await db
      .collection("electionCandidates")
      .updateOne(
        { _id: candidates[1]._id },
        { $set: { party: "99", "russianDumaNomination.nominationOrder": 900 } }
      );
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
  it("admits bounded NPC slates atomically while preserving players, profiles and Congress", async () => {
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
    if (!opened) throw new Error("Missing fixture cohort");
    await db.collection("politicalParties").insertMany(
      [1, 2, 3, 4].map((sequentialId) => ({
        countryId: "RU",
        sequentialId,
        regimeStatus: sequentialId === 4 ? "banned" : "registered",
      }))
    );
    const first = new ObjectId(),
      third = new ObjectId();
    await db.collection("npps").insertMany([
      {
        _id: first,
        countryId: "RU",
        name: "First profile",
        party: "1",
        homeState: "CEN",
        currentOffice: { type: "congressDeputy" },
        retiredAt: null,
        cashOnHand: 77,
      },
      {
        _id: third,
        countryId: "RU",
        name: "Third profile",
        party: "3",
        homeState: "NWR",
        currentOffice: null,
        retiredAt: null,
        cashOnHand: 91,
      },
      {
        countryId: "RU",
        name: "Executive profile",
        party: "2",
        homeState: "CEN",
        currentOffice: { type: "president" },
        retiredAt: null,
      },
      {
        countryId: "RU",
        name: "Retired",
        party: "2",
        homeState: "CEN",
        currentOffice: null,
        retiredAt: new Date(0),
      },
      {
        countryId: "RU",
        name: "Technocrat",
        party: "2",
        homeState: "CEN",
        currentOffice: null,
        isTechnocrat: true,
      },
      { countryId: "PL", name: "Foreign", party: "2", homeState: "CEN", currentOffice: null },
      { countryId: "RU", name: "Banned", party: "4", homeState: "CEN", currentOffice: null },
    ]);
    const beforeProfiles = await db.collection("npps").find({}).sort({ _id: 1 }).toArray();
    const district = await db
      .collection<Election>("elections")
      .findOne({ seatId: "RU-duma-CEN-1" });
    if (!district) throw new Error("Missing fixture district");
    const playerId = new ObjectId();
    const player = {
      _id: new ObjectId(),
      characterId: playerId,
      electionId: district._id,
      countryId: "RU",
      characterName: "Player",
      party: "1",
      isNPP: false,
      status: "active",
      enteredAt: new Date(1000),
      russianDumaNomination: { registrationOrder: 10, nominationOrder: 10, capacity: 1 },
    };
    await db.collection("electionCandidates").insertOne(player);
    await db
      .collection("electedOfficials")
      .insertOne({ countryId: "RU", officeType: "congressDeputy", nppId: first });
    await db.command({
      collMod: "countryGameStates",
      validator: { ruDumaNpcAdmissionCohortId: { $exists: false } },
    });
    const input = { db, cohortId: opened.cohortId, turn: 129, now: new Date(1000) };
    await expect(admitRussianDumaNpcNominees(input)).rejects.toMatchObject({ code: 121 });
    expect(await db.collection("electionCandidates").countDocuments()).toBe(1);
    expect(await db.collection("electionCandidates").findOne({ _id: player._id })).toEqual(player);
    expect(
      await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
    ).not.toHaveProperty("ruDumaNpcAdmissionCohortId");
    await db.command({ collMod: "countryGameStates", validator: {} });
    commands = 0;
    const admitted = await admitRussianDumaNpcNominees(input);
    const admissionCommands = commands;
    expect(admitted).toEqual({ created: 451, unrepresentedParties: ["2"] });
    expect(admissionCommands).toBeLessThanOrEqual(18);
    expect(await db.collection("electionCandidates").countDocuments()).toBe(452);
    const npcCandidates = await db.collection("electionCandidates").find({ isNPP: true }).toArray();
    expect(
      npcCandidates.every(
        (row) => row.characterId.equals(row.nppId) && row._id.equals(row.boundedNpcNomineeId)
      )
    ).toBe(true);
    expect(npcCandidates.filter((row) => row.russianDumaNomination.capacity === 225)).toHaveLength(
      2
    );
    expect(npcCandidates.every((row) => !Object.hasOwn(row, "cashOnHand"))).toBe(true);
    expect(await db.collection("npps").find({}).sort({ _id: 1 }).toArray()).toEqual(beforeProfiles);
    expect(await db.collection("electionCandidates").findOne({ _id: player._id })).toEqual(player);
    expect(await db.collection("electedOfficials").countDocuments()).toBe(1);
    commands = 0;
    expect(await admitRussianDumaNpcNominees({ ...input, turn: 130 })).toEqual({
      created: 0,
      unrepresentedParties: ["2"],
    });
    const replayCommands = commands;
    expect(replayCommands).toBeLessThanOrEqual(2);
    expect(await db.collection("electionCandidates").countDocuments()).toBe(452);
    console.info("Duma NPC admission qualification", {
      admissionCommands,
      replayCommands,
      nominees: 451,
      preservedPlayers: 1,
    });
  });
});
