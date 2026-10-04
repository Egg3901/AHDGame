import { writeFile } from "node:fs/promises";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { processRussianAssemblyCampaigns as campaign } from "./assemblyCampaigns";
import { certifyRussianDumaElection } from "./dumaElectionResult";
import { certifyRussianCouncilElection } from "./councilElectionResult";
import { certifyRussianDumaRepeat } from "./dumaRepeatResult";
import { certifyRussianCouncilRepeat } from "./councilRepeatResult";
import { processRuLegislatureTransition as seat } from "./ruLegislatureTransition";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
type Fixture = { _id: string | ObjectId; [key: string]: unknown };
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
describe.skipIf(!uri)("Native Assembly campaigns on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    docsRead = 0,
    bytesRead = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Assembly qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => {
      commands++;
    });
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
      throw new Error("Assembly qualification requires a writable replica-set primary");
  });
  afterAll(async () => {
    await client?.close();
  });
  it("runs first campaigns, joint handover and failed-poll repeats without replacing held offices or filling a lawful vacancy", async () => {
    const db = client.db(`ahd_test_assembly_campaign_${new ObjectId().toHexString()}`);
    try {
      await db
        .collection<Fixture>("gameState")
        .insertOne({ _id: "current", preset: "1991-default" });
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
          houseDistricts: 225,
          stateSenateSeats: 99,
        }))
      );
      await db
        .collection("politicalParties")
        .insertMany(
          [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
        );
      const profiles = [1, 2, 3].flatMap((party) =>
        [0, 1].map((index) => ({
          _id: new ObjectId(),
          name: `Synthetic profile ${party}/${index}`,
          countryId: "RU",
          party: String(party),
          homeState: "CEN",
          currentOffice: { type: "congressDeputy" },
          retiredAt: null,
          money: 500,
          personalAccount: { wealth: 12345 },
        }))
      );
      await db.collection("npps").insertMany(profiles);
      const congressId = new ObjectId();
      await db.collection("electedOfficials").insertOne({
        _id: congressId,
        countryId: "RU",
        officeType: "congressDeputy",
        nppId: profiles[0]._id,
        isNPP: true,
        party: "1",
        seatsHeld: 1000,
      });
      await db.collection<Fixture>("governmentFormations").insertOne({
        _id: "RU",
        governingPartyId: "1",
        coalitionPartyIds: ["1"],
        status: "formed",
        pmName: "Continuing PM",
      });
      const input = { db, game: { preset: "1991-default" }, turn: 129, now: new Date(1000) };
      const metrics: Array<{
        stage: string;
        commands: number;
        docsRead: number;
        bytesRead: number;
      }> = [];
      const record = (stage: string) => {
        metrics.push({ stage, commands, docsRead, bytesRead });
      };
      commands = docsRead = bytesRead = 0;
      const opened = await campaign(input);
      expect(opened).toEqual({
        convocationsOpened: 0,
        firstOpened: 2,
        repeatsOpened: 0,
        npcCandidatesCreated: 1212,
      });
      record("first opening and NPC admission");
      expect(commands).toBeLessThanOrEqual(70);
      expect(await db.collection("elections").countDocuments()).toBe(315);
      const country = await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" });
      const dumaRoot = country!.ruFirstDumaElectionCohortId as ObjectId,
        councilRoot = country!.ruFirstCouncilElectionCohortId as ObjectId;
      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({})
        .toArray();
      const dumaProfiles = new Set(
        candidates.filter((row) => row.russianDumaNomination).map((row) => row.nppId!.toHexString())
      );
      expect(
        candidates
          .filter((row) => row.russianCouncilNomination)
          .every((row) => !dumaProfiles.has(row.nppId!.toHexString()))
      ).toBe(true);
      expect(await db.collection("npps").countDocuments()).toBe(6);
      commands = docsRead = bytesRead = 0;
      expect(await campaign({ ...input, turn: 130 })).toEqual({
        convocationsOpened: 0,
        firstOpened: 0,
        repeatsOpened: 0,
        npcCandidatesCreated: 0,
      });
      record("settled campaign replay");
      expect(commands).toBeLessThanOrEqual(4);
      await countCampaign(db, dumaRoot, "duma", true);
      await countCampaign(db, councilRoot, "council", true);
      await certifyRussianDumaElection({
        db,
        cohortId: dumaRoot,
        turn: 141,
        now: new Date(43201000),
      });
      await certifyRussianCouncilElection({
        db,
        cohortId: councilRoot,
        turn: 141,
        now: new Date(43201000),
      });
      expect(await seat(db, input.game, 141, new Date(43201000))).toBe("none");
      expect(await db.collection("electedOfficials").findOne({ _id: congressId })).not.toBeNull();
      expect(await seat(db, input.game, 145, new Date(57601000))).toBe("federalAssembly");
      expect(await db.collection("russianAssemblySeatings").findOne({})).toMatchObject({
        dumaSeats: 449,
        councilSeats: 175,
        dumaTermEndTurn: 237,
        councilTermEndTurn: 237,
      });
      const held = await db.collection("electedOfficials").find({}).toArray();
      commands = docsRead = bytesRead = 0;
      expect(await campaign({ ...input, turn: 145, now: new Date(57601000) })).toEqual({
        convocationsOpened: 0,
        firstOpened: 0,
        repeatsOpened: 2,
        npcCandidatesCreated: 9,
      });
      record("two failed-poll repeats and NPC admission");
      expect(commands).toBeLessThanOrEqual(90);
      const repeatDuma = await db
        .collection<Fixture>("russianDumaRepeatOpenings")
        .findOne({ rootCohortId: dumaRoot });
      const repeatCouncil = await db
        .collection<Fixture>("russianCouncilElectionOpenings")
        .findOne({ rootCohortId: councilRoot });
      expect(repeatDuma!.electionIds).toHaveLength(1);
      expect(repeatCouncil!.electionIds).toHaveLength(1);
      await countCampaign(db, repeatDuma!.cohortId as ObjectId, "duma", false);
      await countCampaign(db, repeatCouncil!.cohortId as ObjectId, "council", false);
      const certification = { db, generation: 1, turn: 157, now: new Date(100801000) };
      await certifyRussianDumaRepeat({ ...certification, rootCohortId: dumaRoot });
      await certifyRussianCouncilRepeat({ ...certification, rootCohortId: councilRoot });
      expect(await seat(db, input.game, 157, certification.now)).toBe("federalAssembly");
      const final = await db.collection("electedOfficials").find({}).toArray();
      for (const old of held) expect(final.find((row) => row._id.equals(old._id))).toEqual(old);
      expect(await db.collection("russianAssemblySeatings").findOne({ revision: 1 })).toMatchObject(
        { dumaSeats: 450, councilSeats: 177, councilVacancies: 1, termEndTurn: 237 }
      );
      expect(
        (await db.collection("npps").find({}).toArray()).every(
          (row) => row.money === 500 && row.personalAccount.wealth === 12345
        )
      ).toBe(true);
      commands = docsRead = bytesRead = 0;
      expect(await campaign({ ...input, turn: 158, now: new Date(104401000) })).toEqual({
        convocationsOpened: 0,
        firstOpened: 0,
        repeatsOpened: 0,
        npcCandidatesCreated: 0,
      });
      record("settled campaign replay");
      expect(commands).toBeLessThanOrEqual(4);
      if (process.env.FEDERATION_TEST_REPORT_PATH)
        await writeFile(
          process.env.FEDERATION_TEST_REPORT_PATH,
          JSON.stringify(metrics, null, 2) + "\n",
          "utf8"
        );
      expect(await db.collection("elections").countDocuments()).toBe(317);
      expect(await db.collection("npps").countDocuments()).toBe(6);
    } finally {
      await db.dropDatabase();
    }
  });
});
