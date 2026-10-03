/** Electoral law consent and cohort custody qualify on an isolated replica set. */
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import { processRussianAssemblyCampaigns } from "./assemblyCampaigns";
import { certifyRussianDumaRepeat } from "./dumaRepeatResult";
import { processRuLegislatureTransition } from "./ruLegislatureTransition";
import { certifyRussianDumaElection } from "./dumaElectionResult";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { processRussian1991Bills } from "./billLifecycle";
import { materializeRussianDumaConvocationOpening } from "./dumaConvocationOpening";
import {
  openRussianDuma1995Proposal,
  processRussianDuma1995Mandate,
} from "./dumaElectoralProposals1995";
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z"),
  GAME = { preset: "1991-default" };
type Row = { _id: string; [key: string]: unknown };
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
  "characters",
  "russianAssemblySeatings",
  "russianAssemblyOfficeArchives",
  "russianDumaConvocations",
  "russianDumaLawProposals",
  "bills",
  "politicalParties",
  "electionCandidates",
  "electionVoteTallies",
];
describe.skipIf(!uri)("Duma1995 actual bicameral consent", () => {
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
  async function fixture() {
    const db = client.db(`ahd_test_duma1995_${new ObjectId().toHexString()}`);
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
    await db
      .collection("states")
      .updateMany({}, { $set: { population: 1000000, votingEligiblePopulation: 700000 } });
    const nominees = f.mem.collection("russianDumaElectionResults").docs[0].nominees as Array<{
      ownerId: ObjectId;
      name: string;
      party: string;
    }>;
    await db.collection("npps").bulkWrite(
      nominees.map((row) => ({
        updateOne: {
          filter: { _id: row.ownerId },
          update: { $set: { name: row.name, party: row.party } },
        },
      }))
    );
    await db
      .collection("politicalParties")
      .insertMany(
        [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
      );
    await db
      .collection<Row>("countryGameStates")
      .updateOne({ _id: "RU" }, { $set: { ruPresidencySinceTurn: 141 } });
    return { db, f };
  }
  async function opening(db: Db) {
    return runRequiredTransaction(
      (session) =>
        materializeRussianDumaConvocationOpening({
          db,
          session,
          game: GAME,
          turn: 225,
          now: NOW,
          cohortId: new ObjectId(),
          electionIds: Array.from({ length: 226 }, () => new ObjectId()),
        }),
      { client }
    );
  }
  async function votes(db: Db, officeType: string, support: boolean) {
    const officials = await db
      .collection("electedOfficials")
      .find({ countryId: "RU", officeType })
      .toArray();
    return Object.fromEntries(
      officials.map((row) => [`npp_${row.nppId}`, support || row.party !== "1" ? "for" : "against"])
    );
  }
  async function legislate(db: Db, lower: boolean, upper: boolean) {
    const proposal = await openRussianDuma1995Proposal({
      db,
      game: GAME,
      turn: 213,
      now: NOW,
      sponsor: null,
    });
    await processRussian1991Bills(db, NOW, 213);
    await db
      .collection("bills")
      .updateOne(
        { _id: proposal.billId },
        { $set: { votes: await votes(db, "dumaDeputy", lower), votingEndsOnTurn: 214 } }
      );
    await processRussian1991Bills(db, NOW, 214);
    let bill = await db.collection("bills").findOne({ _id: proposal.billId });
    expect(bill?.status).toBe(lower ? "active_other" : "failed");
    if (!lower) return proposal;
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: {
          otherChamberVotes: await votes(db, "federationCouncilMember", upper),
          otherChamberVotingEndsOnTurn: 215,
        },
      }
    );
    await processRussian1991Bills(db, NOW, 215);
    bill = await db.collection("bills").findOne({ _id: proposal.billId });
    expect(bill?.status).toBe(upper ? "enrolled" : "failed");
    if (upper) {
      expect(await processRussianDuma1995Mandate(db, GAME, 215, NOW)).toBe(false);
      await db
        .collection("bills")
        .updateOne({ _id: proposal.billId }, { $set: { presidentActionDeadlineOnTurn: 216 } });
      await processRussian1991Bills(db, NOW, 216);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "signed"
      );
    }
    return proposal;
  }
  it.each([
    [true, true],
    [false, true],
    [true, false],
  ] as const)(
    "requires both chamber votes lower%s upper%s before presidential enactment",
    async (lower, upper) => {
      const { db } = await fixture();
      try {
        const original = await db.collection("elections").find().sort({ _id: 1 }).toArray();
        const financial = await db
          .collection("npps")
          .find({}, { projection: { money: 1, personalAccount: 1 } })
          .sort({ _id: 1 })
          .toArray();
        const council = await db
          .collection("electedOfficials")
          .find({ officeType: "federationCouncilMember" })
          .sort({ _id: 1 })
          .toArray();
        await legislate(db, lower, upper);
        commands = requestBytes = replyBytes = 0;
        expect(await processRussianDuma1995Mandate(db, GAME, 216, NOW)).toBe(lower && upper);
        process.stdout.write(
          JSON.stringify({
            fixture: `ru1995-consent-${lower}-${upper}`,
            commands,
            requestBytes,
            replyBytes,
          }) + "\n"
        );
        expect(await db.collection("elections").find().sort({ _id: 1 }).toArray()).toEqual(
          original
        );
        expect(await opening(db)).toMatchObject({ created: true });
        const polls = await db.collection("elections").find({ cycle: 2 }).toArray();
        expect(polls).toHaveLength(226);
        expect(
          polls.every(
            (row) =>
              (row.russianDumaRound.electoralLaw ?? "decree1993") ===
              (lower && upper ? "law1995" : "decree1993")
          )
        ).toBe(true);

        if (lower && upper) {
          await processRussianAssemblyCampaigns({ db, game: GAME, turn: 225, now: NOW });
          const root = (await db.collection<Row>("countryGameStates").findOne({ _id: "RU" }))!
            .ruDumaConvocationCohortId as ObjectId;
          const elections = await db
            .collection<Election>("elections")
            .find({ "russianDumaRound.cohortId": root })
            .toArray();
          const candidates = await db
            .collection<ElectionCandidate>("electionCandidates")
            .find({ electionId: { $in: elections.map((row) => row._id) } })
            .toArray();
          await db.collection("electionVoteTallies").insertMany(
            elections.map((election) => {
              const roster = candidates.filter((row) => row.electionId.equals(election._id));
              const registered = election.russianDumaRound!.registeredVoters;
              const list = election.russianDumaRound!.tier === "list";
              const totalVotes = Object.fromEntries(
                roster.map((row) => [
                  row._id.toHexString(),
                  Math.floor(
                    registered *
                      (list
                        ? row.party === "1"
                          ? 0.855
                          : row.party === "2"
                            ? 0.045
                            : 0
                        : row.party === "1"
                          ? 0.6
                          : row.party === "2"
                            ? 0.4
                            : 0)
                  ),
                ])
              );
              return {
                _id: new ObjectId(),
                electionId: election._id,
                state: election.state,
                totalVotes,
                candidateNames: Object.fromEntries(
                  roster.map((row) => [row._id.toHexString(), row.characterName])
                ),
                candidateParties: Object.fromEntries(
                  roster.map((row) => [row._id.toHexString(), row.party])
                ),
                turnSnapshots: [],
                finalized: false,
                russianDumaBallot: {
                  againstAllVotes: 0,
                  invalidBallots: list ? Math.floor(registered * 0.1) : 0,
                },
              };
            })
          );
          const failed = elections.find((row) => row.russianDumaRound!.tier === "constituency")!;
          await db.collection("electionVoteTallies").updateOne(
            { electionId: failed._id },
            {
              $set: {
                totalVotes: Object.fromEntries(
                  candidates
                    .filter((row) => row.electionId.equals(failed._id))
                    .map((row) => [row._id.toHexString(), 0])
                ),
              },
            }
          );
          await db
            .collection("elections")
            .updateMany({ "russianDumaRound.cohortId": root }, { $set: { status: "completed" } });
          const result = await certifyRussianDumaElection({
            db,
            cohortId: root,
            turn: 237,
            now: NOW,
          });
          expect(result.result.listDecision).toMatchObject({
            outcome: "elected",
            partySeats: { "1": 225, "2": 0, "3": 0 },
          });
          expect(result.ballots!.every((row) => row.law === "law1995")).toBe(true);
          expect(await processRuLegislatureTransition(db, GAME, 237, NOW)).toBe("federalAssembly");
          expect(
            await processRussianAssemblyCampaigns({ db, game: GAME, turn: 240, now: NOW })
          ).toMatchObject({ repeatsOpened: 1, npcCandidatesCreated: 3 });
          const repeat = await db
            .collection("russianDumaRepeatOpenings")
            .findOne({ rootCohortId: root });
          const repeatPoll = await db
            .collection<Election>("elections")
            .findOne({ "russianDumaRound.cohortId": repeat!.cohortId });
          expect(repeatPoll!.russianDumaRound!.electoralLaw).toBe("law1995");
          const repeatCandidates = await db
            .collection<ElectionCandidate>("electionCandidates")
            .find({ electionId: repeatPoll!._id })
            .toArray();
          await db.collection("electionVoteTallies").insertOne({
            _id: new ObjectId(),
            electionId: repeatPoll!._id,
            state: repeatPoll!.state,
            totalVotes: Object.fromEntries(
              repeatCandidates.map((row) => [
                row._id.toHexString(),
                row.party === "1" ? repeatPoll!.russianDumaRound!.registeredVoters : 0,
              ])
            ),
            candidateNames: Object.fromEntries(
              repeatCandidates.map((row) => [row._id.toHexString(), row.characterName])
            ),
            candidateParties: Object.fromEntries(
              repeatCandidates.map((row) => [row._id.toHexString(), row.party])
            ),
            turnSnapshots: [],
            finalized: false,
            russianDumaBallot: { againstAllVotes: 0 },
          });
          await db
            .collection("elections")
            .updateOne({ _id: repeatPoll!._id }, { $set: { status: "completed" } });
          await certifyRussianDumaRepeat({
            db,
            rootCohortId: root,
            generation: 1,
            turn: 252,
            now: NOW,
          });
          expect(await processRuLegislatureTransition(db, GAME, 252, NOW)).toBe("federalAssembly");
          const held = await db
            .collection("electedOfficials")
            .find({ officeType: "dumaDeputy" })
            .toArray();
          expect(held.reduce((n, row) => n + (row.seatsHeld ?? 1), 0)).toBe(450);
          expect(
            await db
              .collection("electedOfficials")
              .find({ officeType: "federationCouncilMember" })
              .sort({ _id: 1 })
              .toArray()
          ).toEqual(council);
          expect(
            await db
              .collection("npps")
              .find({}, { projection: { money: 1, personalAccount: 1 } })
              .sort({ _id: 1 })
              .toArray()
          ).toEqual(financial);
        }
      } finally {
        await db.dropDatabase();
      }
    },
    90000
  );
  it("rolls back the final enactment receipt and resolves concurrent claims exactly once", async () => {
    const { db } = await fixture();
    try {
      await legislate(db, true, true);
      const original = await db.collection<Row>("countryGameStates").findOne({ _id: "RU" });
      await db.command({
        collMod: "russianDumaLawProposals",
        validator: { impossibleQualificationField: { $exists: true } },
        validationLevel: "strict",
      });
      await expect(processRussianDuma1995Mandate(db, GAME, 216, NOW)).rejects.toThrow();
      expect(await db.collection<Row>("countryGameStates").findOne({ _id: "RU" })).toEqual(
        original
      );
      expect((await db.collection("russianDumaLawProposals").findOne({}))?.status).toBe("open");
      await db.command({
        collMod: "russianDumaLawProposals",
        validator: {},
        validationLevel: "off",
      });
      commands = requestBytes = replyBytes = 0;
      expect(
        (
          await Promise.all([
            processRussianDuma1995Mandate(db, GAME, 216, NOW),
            processRussianDuma1995Mandate(db, GAME, 216, NOW),
          ])
        ).sort()
      ).toEqual([false, true]);
      process.stdout.write(
        JSON.stringify({ fixture: "ru1995-competing", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBeLessThanOrEqual(50);
      commands = requestBytes = replyBytes = 0;
      expect(await processRussianDuma1995Mandate(db, GAME, 217, NOW)).toBe(false);
      process.stdout.write(
        JSON.stringify({ fixture: "ru1995-replay", commands, requestBytes, replyBytes }) + "\n"
      );
      expect(commands).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  }, 90000);
  it("retains an open campaign's decree after the new law takes effect", async () => {
    const { db } = await fixture();
    try {
      await opening(db);
      const before = await db.collection("elections").find().sort({ _id: 1 }).toArray();
      await legislate(db, true, true);
      expect(await processRussianDuma1995Mandate(db, GAME, 226, NOW)).toBe(true);
      expect(await opening(db)).toMatchObject({ created: false });
      expect(await db.collection("elections").find().sort({ _id: 1 }).toArray()).toEqual(before);
    } finally {
      await db.dropDatabase();
    }
  }, 90000);
});
