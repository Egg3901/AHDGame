import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import {
  HU_1994_PROPOSALS_COLLECTION,
  openHu1994ElectoralProposal,
  authorizeHu1994ElectoralProposal,
  processHu1994ElectoralMandate,
  type Hu1994ElectoralProposal,
} from "./electoralProposals1994";
import { huRegions1991 } from "./data/huRegions1991";
import { bindHu1991Campaigns } from "./assemblyCampaignBinding1991";
import {
  certifyHu1991FirstCount,
  HU_1991_COUNTS_COLLECTION,
  type Hu1991AssemblyRecord,
} from "./assemblyCount1991";
import { seatHu1991Assembly } from "./assemblySeating1991";
import { processHu1994ElectoralNpcProposal } from "./electoralNpcProposals1994";
import { HU_1991_TERRITORIAL_DISTRICTS } from "./data/electoralDistricts1991";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/analytics/billStatusAnalytics", () => ({ captureBillStatusChanged: vi.fn() }));

const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z");
const GAME = { preset: "1991-default" };
type StringRecord = { _id: string; [key: string]: unknown };

describe.skipIf(!uri)("Hungarian 1994 amendment on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    commandBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Electoral qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (event) => {
      commands++;
      commandBytes += BSON.calculateObjectSize(event.command);
    });
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
    });
    await client.connect();
    vi.mocked(getMongoClient).mockResolvedValue(client);
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Electoral qualification requires writable replica set");
  });
  afterAll(async () => {
    await client?.close();
  });

  async function fixture(forSeats = 130, againstSeats = 64) {
    const db = client.db(`ahd_test_hu_1994_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "governmentFormations",
      "electedOfficials",
      "bills",
      HU_1994_PROPOSALS_COLLECTION,
      "elections",
      "electionVoteTallies",
      "hu1991AssemblyCounts",
      "npps",
    ])
      await db.createCollection(name);
    await db
      .collection<StringRecord>("gameState")
      .insertOne({ _id: "current", preset: "1991-default", currentTurn: 145 });
    await db
      .collection<StringRecord>("countryState")
      .insertOne({ ...seedCountryStateFromConfig("HU", NOW, "1991-default") });
    await db.collection<StringRecord>("countryGameStates").insertOne({ _id: "HU" });
    await db
      .collection<StringRecord>("governmentFormations")
      .insertOne({ _id: "HU", status: "formed" });
    const yes = new ObjectId(),
      no = new ObjectId(),
      absent = new ObjectId();
    await db.collection("electedOfficials").insertMany(
      Array.from({ length: 386 }, (_, i) => ({
        countryId: "HU",
        officeType: "assemblyDelegate",
        nppId: i < forSeats ? yes : i < forSeats + againstSeats ? no : absent,
        seatsHeld: 1,
        party: i < forSeats ? "1" : "2",
      }))
    );
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 145 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    return { db, yes, no };
  }
  async function vote(db: Db, yes: ObjectId, no: ObjectId) {
    const proposal = await openHu1994ElectoralProposal({
      db,
      game: GAME,
      turn: 145,
      now: NOW,
      sponsor: null,
    });
    await processOnePartyBillLifecycleForCountry("HU", NOW);
    expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe("active");
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: {
          votes: { [`npp_${yes}`]: "for", [`npp_${no}`]: "against" },
          votingEndsOnTurn: 146,
        },
      }
    );
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 146 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    await processOnePartyBillLifecycleForCountry("HU", NOW);
    return proposal;
  }
  async function primary(db: Db, cycle: number, withVotes = false, primaryEndTurn = 200) {
    const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
    const rows = regions.map((state) => ({
      _id: new ObjectId(),
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle,
      state,
      status: "active",
      primaryEndTurn,
      hungarianAssemblyRound: {
        ruleVersion: "mixed-1989-v1",
        round: 1,
        registeredVoters: 100,
        receiptId: `HU:mixed1989:${cycle}`,
      },
    }));
    await db.collection("elections").insertMany(rows);
    await db.collection("electionVoteTallies").insertMany(
      rows.map((row) => ({
        electionId: row._id,
        totalVotes: withVotes ? { old: 1 } : {},
        finalized: false,
      }))
    );
    return rows;
  }

  it("enacts at the minimum quorum, rolls back final authorization failure, and rebinds only untouched primaries", async () => {
    const { db, yes, no } = await fixture();
    try {
      await primary(db, 1);
      await primary(db, 2, true);
      await primary(db, 3, false, 146);
      const proposal = await vote(db, yes, no);
      const enacted = await db.collection("bills").findOne({ _id: proposal.billId });
      expect(enacted?.status).toBe("signed");
      expect(enacted?.voteSnapshot.totals).toEqual({ for: 130, against: 64, abstain: 0 });
      const fail = new Proxy(db, {
        get(target, key) {
          if (key !== "collection") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (name: string) => {
            const collection = target.collection(name);
            if (name !== HU_1994_PROPOSALS_COLLECTION) return collection;
            return new Proxy(collection, {
              get(inner, property) {
                if (property === "updateOne")
                  return async () => {
                    throw new Error("injected final authorization failure");
                  };
                const value = Reflect.get(inner, property);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        },
      });
      await expect(
        runRequiredTransaction(
          (session) => authorizeHu1994ElectoralProposal(fail, GAME, 146, NOW, session),
          { client }
        )
      ).rejects.toThrow("injected final authorization failure");
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralLaw1994SinceTurn
      ).toBeUndefined();
      expect(
        await db
          .collection("elections")
          .countDocuments({ "hungarianAssemblyRound.electoralLaw": "mixed-1994-v1" })
      ).toBe(0);
      commands = commandBytes = replyBytes = 0;
      const results = await Promise.all([
        processHu1994ElectoralMandate(db, GAME, 146, NOW),
        processHu1994ElectoralMandate(db, GAME, 146, NOW),
      ]);
      console.info({
        fixture: "hu-1994-concurrent-authorization",
        commands,
        commandBytes,
        replyBytes,
      });
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralLaw1994SinceTurn
      ).toBe(146);
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 1, "hungarianAssemblyRound.electoralLaw": "mixed-1994-v1" })
      ).toBe(6);
      expect(
        await db.collection("elections").countDocuments({
          cycle: { $in: [2, 3] },
          "hungarianAssemblyRound.electoralLaw": "mixed-1994-v1",
        })
      ).toBe(0);
      expect(await processHu1994ElectoralMandate(db, GAME, 147, NOW)).toBe(false);
      expect(
        (await db.collection("bills").findOne({ _id: proposal.billId }))?.voteSnapshot
      ).toEqual(enacted?.voteSnapshot);
    } finally {
      await db.dropDatabase();
    }
  });

  it.each([
    [129, 65],
    [193, 0],
  ])("keeps a rejected %i/%i decision and unchanged law", async (yesSeats, noSeats) => {
    const { db, yes, no } = await fixture(yesSeats, noSeats);
    try {
      const proposal = await vote(db, yes, no);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "failed"
      );
      expect(await processHu1994ElectoralMandate(db, GAME, 146, NOW)).toBe(false);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralLaw1994SinceTurn
      ).toBeUndefined();
    } finally {
      await db.dropDatabase();
    }
  });

  it("binds the enacted law into the next complete campaign and seats 386 mandates without financial clones", async () => {
    const { db, yes, no } = await fixture();
    try {
      await vote(db, yes, no);
      expect(await processHu1994ElectoralMandate(db, GAME, 146, NOW)).toBe(true);
      for (const name of [
        "states",
        "stateRegistrationPool",
        "electionCandidates",
        "characters",
        "hu1991AssemblyOfficeArchives",
        "notifications",
      ])
        await db.createCollection(name);
      await db
        .collection<StringRecord>("states")
        .insertMany(huRegions1991.map((row) => ({ ...row, votingEligiblePopulation: 1000000 })));
      await db
        .collection("stateRegistrationPool")
        .insertMany(
          huRegions1991.map((row) => ({ countryId: "HU", stateId: row._id, unregistered: 0 }))
        );
      for (const region of huRegions1991) {
        const electionId = new ObjectId();
        await db.collection("elections").insertOne({
          _id: electionId,
          countryId: "HU",
          electionType: "nationalAssembly",
          state: region._id,
          cycle: 1,
          electionYear: 1994,
          status: "active",
          primaryEndTurn: 149,
          endTurn: 150,
        });
        const totalVotes: Record<string, number> = {},
          candidateParties: Record<string, string> = {};
        for (const party of ["1", "2"]) {
          const owner = new ObjectId(),
            candidate = new ObjectId();
          await db.collection("npps").insertOne({
            _id: owner,
            countryId: "HU",
            party,
            balance: 12345,
            currentOffice: null,
            retiredAt: null,
          });
          await db.collection("electionCandidates").insertOne({
            _id: candidate,
            electionId,
            nppId: owner,
            characterId: owner,
            isNPP: true,
            party,
            characterName: `Synthetic ${region._id} ${party}`,
            enteredAt: NOW,
            status: "active",
          });
          totalVotes[candidate.toHexString()] = party === "1" ? 950000 : 50000;
          candidateParties[candidate.toHexString()] = party;
        }
        await db
          .collection("electionVoteTallies")
          .insertOne({ electionId, totalVotes, candidateParties, finalized: false });
      }
      expect(await bindHu1991Campaigns(db, NOW, [1])).toBe(6);
      expect(
        await db
          .collection("elections")
          .countDocuments({ "hungarianAssemblyRound.electoralLaw": "mixed-1994-v1" })
      ).toBe(6);
      await db.collection("elections").updateMany({ cycle: 1 }, { $set: { status: "completed" } });
      commands = commandBytes = replyBytes = 0;
      const receipt = await certifyHu1991FirstCount(db, 1, 150, NOW);
      expect(receipt?.first.electoralLaw).toBe("mixed-1994-v1");
      expect(receipt?.nominations.electoralLaw).toBe("mixed-1994-v1");
      expect(receipt?.nominations.national[0].candidateIds).toHaveLength(174);
      expect(receipt?.count).toMatchObject({
        kind: "counted",
        eligibleParties: ["1"],
        partySeats: { "1": 386 },
      });
      const installed = await seatHu1991Assembly(db, 1, 151, NOW);
      console.info({ fixture: "hu-1994-count-and-handover", commands, commandBytes, replyBytes });
      expect(installed).toBe(true);
      expect(
        (
          await db
            .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
            .findOne({ _id: receipt!._id })
        )?.settled?.mandates
      ).toHaveLength(386);
      expect(
        await db
          .collection("electedOfficials")
          .countDocuments({ countryId: "HU", officeType: "assemblyDelegate", party: "1" })
      ).toBe(386);
      expect(await db.collection("npps").countDocuments()).toBe(12);
      expect(await db.collection("npps").countDocuments({ balance: 12345 })).toBe(12);
      await db
        .collection<StringRecord>("countryGameStates")
        .updateOne({ _id: "HU" }, { $unset: { huElectoralLaw1994SinceTurn: "" } });
      expect((await certifyHu1991FirstCount(db, 1, 152, NOW))?.first).toEqual(receipt!.first);
    } finally {
      await db.dropDatabase();
    }
  });

  it("records bounded NPC government introduction and leaves human or rejected decisions alone", async () => {
    const { db, yes } = await fixture(300, 86);
    try {
      await db
        .collection<StringRecord>("governmentFormations")
        .updateOne({ _id: "HU" }, { $set: { pmNppId: yes } });
      await db.collection("npps").insertOne({ _id: yes, party: "1" });
      const holder = await db.collection("electedOfficials").findOne({ nppId: yes });
      await db
        .collection("electedOfficials")
        .updateOne({ _id: holder!._id }, { $set: { characterId: new ObjectId() } });
      expect(
        await processHu1994ElectoralNpcProposal(
          db,
          { ...GAME } as Parameters<typeof processHu1994ElectoralNpcProposal>[1],
          145,
          NOW
        )
      ).toBe(false);
      await db
        .collection("electedOfficials")
        .updateOne({ _id: holder!._id }, { $unset: { characterId: "" } });
      expect(
        await processHu1994ElectoralNpcProposal(
          db,
          { ...GAME } as Parameters<typeof processHu1994ElectoralNpcProposal>[1],
          145,
          NOW
        )
      ).toBe(true);
      const proposal = await db
        .collection<Hu1994ElectoralProposal>(HU_1994_PROPOSALS_COLLECTION)
        .findOne({ _id: "1991-default:hu-electoral:threshold1994" });
      expect(proposal?.reason).toBe("npc_government_threshold_mandate");
      await db
        .collection("bills")
        .updateOne({ _id: proposal!.billId }, { $set: { status: "failed" } });
      expect(
        await processHu1994ElectoralNpcProposal(
          db,
          { ...GAME } as Parameters<typeof processHu1994ElectoralNpcProposal>[1],
          146,
          NOW
        )
      ).toBe(false);
      expect(await db.collection("bills").countDocuments()).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
});
