import { writeFile } from "node:fs/promises";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import { processRussianAssemblyCampaigns as campaign } from "./assemblyCampaigns";
import { certifyRussianDumaElection } from "./dumaElectionResult";
import { certifyRussianDumaRepeat } from "./dumaRepeatResult";
import { processRuLegislatureTransition as seat } from "./ruLegislatureTransition";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const collections = [
  "gameState",
  "countryGameStates",
  "russianDumaElectionResults",
  "russianCouncilElectionResults",
  "npps",
  "electedOfficials",
  "states",
  "elections",
  "governmentFormations",
  "politicalParties",
  "characters",
  "electionCandidates",
  "electionVoteTallies",
  "russianAssemblySeatings",
  "russianAssemblyOfficeArchives",
  "russianDumaConvocations",
  "russianDumaRepeatOpenings",
];
async function countCampaign(db: Db, root: ObjectId, chamber: "duma" | "council", first: boolean) {
  const field = chamber === "duma" ? "russianDumaRound" : "russianCouncilRound";
  const elections = await db
    .collection<Election>("elections")
    .find({ [field + ".cohortId"]: root })
    .sort({ seatId: 1 })
    .toArray();
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: { $in: elections.map((row) => row._id) } })
    .sort({ _id: 1 })
    .toArray();
  const tallies = elections.map((election, index) => {
    const rows = candidates.filter((row) => row.electionId.equals(election._id));
    const register =
      chamber === "duma"
        ? election.russianDumaRound!.registeredVoters
        : election.russianCouncilRound!.registeredVoters;
    const failed = first && index === 0;
    const lawfulVacancy = chamber === "council" && first && index === 1;
    let againstAllVotes = 0;
    if (lawfulVacancy) againstAllVotes = Math.floor(register * 0.3);
    const totalVotes: Record<string, number> = {};
    for (const [position, candidate] of rows.entries()) {
      const share =
        chamber === "duma"
          ? election.russianDumaRound!.tier === "list"
            ? 1 / 3
            : candidate.party === "1"
              ? 0.6
              : candidate.party === "2"
                ? 0.4
                : 0
          : position === 0
            ? 0.6
            : position === 1
              ? lawfulVacancy
                ? 0.2
                : 0.5
              : position === 2
                ? lawfulVacancy
                  ? 0.1
                  : 0.4
                : 0;
      totalVotes[candidate._id.toHexString()] = failed ? 0 : Math.floor(register * share);
    }
    return {
      _id: new ObjectId(),
      electionId: election._id,
      finalized: false,
      totalVotes,
      candidateParties: Object.fromEntries(rows.map((row) => [row._id.toHexString(), row.party])),
      ...(chamber === "duma"
        ? { russianDumaBallot: { againstAllVotes: 0 } }
        : {
            russianCouncilBallot: {
              validBallots: failed ? 0 : register,
              againstAllVotes,
              registeredVoters: register,
              registrationOrderByCandidate: Object.fromEntries(
                rows.map((row) => [
                  row._id.toHexString(),
                  row.russianCouncilNomination!.registrationOrder,
                ])
              ),
            },
          }),
    };
  });
  await db.collection("electionVoteTallies").insertMany(tallies);
  await db
    .collection("elections")
    .updateMany({ [field + ".cohortId"]: root }, { $set: { status: "completed" } });
  return elections;
}
describe.skipIf(!uri)("Ordinary Duma transactions on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    docsRead = 0,
    bytesRead = 0;
  const metrics: Array<{ stage: string; commands: number; docsRead: number; bytesRead: number }> =
    [];
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Duma qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => commands++);
    client.on("commandSucceeded", (event) => {
      const reply = event.reply;
      if (!reply || typeof reply !== "object" || !("cursor" in reply)) return;
      const cursor = reply.cursor;
      if (!cursor || typeof cursor !== "object") return;
      const rows =
        "firstBatch" in cursor ? cursor.firstBatch : "nextBatch" in cursor ? cursor.nextBatch : [];
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        docsRead++;
        bytesRead += BSON.calculateObjectSize(row);
      }
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Duma qualification requires writable replica-set primary");
  });
  afterAll(async () => {
    console.info("Duma phase read metrics", JSON.stringify(metrics));
    if (process.env.FEDERATION_TEST_DUMA_REPORT_PATH)
      await writeFile(
        process.env.FEDERATION_TEST_DUMA_REPORT_PATH,
        JSON.stringify(metrics, null, 2) + "\n"
      );
    await client?.close();
  });
  async function fixture() {
    const db = client.db(`ahd_test_duma_convocations_${new ObjectId().toHexString()}`);
    const f = russianAssemblySeatingRuntimeScenario();
    for (const name of collections) {
      const rows = f.mem.collection(name).docs;
      if (rows.length) await db.collection(name).insertMany(rows);
      else await db.createCollection(name);
    }
    await runRequiredTransaction(
      (session) => materializeRussianAssemblySeating({ ...f.input, db, session }),
      { client }
    );
    const first = f.mem.collection("russianDumaElectionResults").docs[0];
    const nominees = first.nominees as Array<{ ownerId: ObjectId; name: string; party: string }>;
    await db.collection("npps").bulkWrite(
      nominees.map((n) => ({
        updateOne: {
          filter: { _id: n.ownerId },
          update: { $set: { name: n.name, party: n.party } },
        },
      }))
    );
    await db
      .collection("states")
      .updateMany({}, { $set: { population: 1000000, votingEligiblePopulation: 700000 } });
    await db
      .collection("politicalParties")
      .insertMany(
        [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
      );
    return { db, dumaRoot: f.dumaRoot, councilRoot: f.councilRoot };
  }
  async function snapshot(db: Db, names = collections) {
    return Promise.all(
      names.map(async (name) => [
        name,
        await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
      ])
    );
  }
  async function upper(db: Db) {
    return db
      .collection("electedOfficials")
      .find({ officeType: "federationCouncilMember" })
      .sort({ _id: 1 })
      .toArray();
  }
  async function cash(db: Db) {
    return db
      .collection("npps")
      .find({}, { projection: { money: 1, personalAccount: 1 } })
      .sort({ _id: 1 })
      .toArray();
  }
  async function phase<T>(stage: string, fn: () => Promise<T>) {
    commands = docsRead = bytesRead = 0;
    const value = await fn();
    metrics.push({ stage, commands, docsRead, bytesRead });
    expect(commands).toBeLessThanOrEqual(100);
    return value;
  }
  const game = { preset: "1991-default" };
  const now = new Date(1000);
  it("opens second and third convocations, hands over only the Duma, and fills failed ballots once", async () => {
    const { db, dumaRoot, councilRoot } = await fixture();
    try {
      const retained = await upper(db),
        money = await cash(db);
      const firstJournal = await db
        .collection<{ _id: string; [key: string]: unknown }>("russianAssemblySeatings")
        .findOne({ _id: `${dumaRoot}:${councilRoot}` });
      expect(
        await phase("before second campaign", () => campaign({ db, game, turn: 224, now }))
      ).toMatchObject({ convocationsOpened: 0 });
      expect(
        await phase("second campaign", () => campaign({ db, game, turn: 225, now }))
      ).toMatchObject({ convocationsOpened: 1, npcCandidatesCreated: 678 });
      const country = await db
        .collection<{ _id: string; ruDumaConvocationCohortId?: ObjectId }>("countryGameStates")
        .findOne({ _id: "RU" });
      const root = country!.ruDumaConvocationCohortId as ObjectId;
      await countCampaign(db, root, "duma", true);
      await certifyRussianDumaElection({ db, cohortId: root, turn: 237, now });
      expect(await phase("second seating", () => seat(db, game, 237, now))).toBe("federalAssembly");
      const held = await db
        .collection("electedOfficials")
        .find({ officeType: "dumaDeputy" })
        .toArray();
      expect(held.reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0)).toBe(449);
      expect(await phase("second replay", () => seat(db, game, 238, now))).toBe("none");
      expect(
        await phase("second failed ballot", () => campaign({ db, game, turn: 240, now }))
      ).toMatchObject({ repeatsOpened: 1, npcCandidatesCreated: 3 });
      const repeat = await db
        .collection("russianDumaRepeatOpenings")
        .findOne({ rootCohortId: root });
      await countCampaign(db, repeat!.cohortId, "duma", false);
      await certifyRussianDumaRepeat({ db, rootCohortId: root, generation: 1, turn: 252, now });
      expect(await phase("second vacancy", () => seat(db, game, 252, now))).toBe("federalAssembly");
      const after = await db
        .collection("electedOfficials")
        .find({ officeType: "dumaDeputy" })
        .toArray();
      expect(after.reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0)).toBe(450);
      expect(held.every((row) => after.some((next) => next._id.equals(row._id)))).toBe(true);
      expect(
        await phase("second completed steady", () => campaign({ db, game, turn: 253, now }))
      ).toMatchObject({ convocationsOpened: 0, repeatsOpened: 0, npcCandidatesCreated: 0 });
      expect(
        await phase("third campaign", () => campaign({ db, game, turn: 417, now }))
      ).toMatchObject({ convocationsOpened: 1, npcCandidatesCreated: 678 });
      const nextCountry = await db
        .collection<{ _id: string; ruDumaConvocationCohortId?: ObjectId }>("countryGameStates")
        .findOne({ _id: "RU" });
      const nextRoot = nextCountry!.ruDumaConvocationCohortId as ObjectId;
      expect(nextRoot.equals(root)).toBe(false);
      await countCampaign(db, nextRoot, "duma", false);
      await certifyRussianDumaElection({ db, cohortId: nextRoot, turn: 429, now });
      expect(await phase("third seating", () => seat(db, game, 429, now))).toBe("federalAssembly");
      const second = await db.collection("russianDumaConvocations").findOne({ cohortId: root });
      const third = await db.collection("russianDumaConvocations").findOne({ cohortId: nextRoot });
      expect(second).toMatchObject({ number: 2, seatedOnTurn: 237, termEndTurn: 429 });
      expect(third).toMatchObject({
        number: 3,
        seatedOnTurn: 429,
        termEndTurn: 621,
        predecessorCohortId: root,
      });
      expect(await upper(db)).toEqual(retained);
      expect(await cash(db)).toEqual(money);
      expect(
        await db
          .collection<{ _id: string; [key: string]: unknown }>("russianAssemblySeatings")
          .findOne({ _id: `${dumaRoot}:${councilRoot}` })
      ).toEqual(firstJournal);
    } finally {
      await db.dropDatabase();
    }
  }, 180000);
  it("rolls back every handover write if the final convocation receipt fails, then commits one concurrent winner", async () => {
    const { db } = await fixture();
    try {
      await campaign({ db, game, turn: 225, now });
      const country = await db
        .collection<{ _id: string; ruDumaConvocationCohortId?: ObjectId }>("countryGameStates")
        .findOne({ _id: "RU" });
      const root = country!.ruDumaConvocationCohortId as ObjectId;
      await countCampaign(db, root, "duma", false);
      await certifyRussianDumaElection({ db, cohortId: root, turn: 237, now });
      const before = await snapshot(db);
      await db.command({
        collMod: "russianDumaConvocations",
        validator: { revision: { $exists: false } },
        validationLevel: "strict",
        validationAction: "error",
      });
      await expect(seat(db, game, 237, now)).rejects.toThrow();
      expect(await snapshot(db)).toEqual(before);
      await db.command({
        collMod: "russianDumaConvocations",
        validator: {},
        validationLevel: "strict",
      });
      const results = await Promise.all([seat(db, game, 237, now), seat(db, game, 237, now)]);
      expect(results.sort()).toEqual(["federalAssembly", "none"]);
      const committed = await snapshot(db);
      expect(await seat(db, game, 238, now)).toBe("none");
      expect(await snapshot(db)).toEqual(committed);
    } finally {
      await db.dropDatabase();
    }
  }, 180000);
});
