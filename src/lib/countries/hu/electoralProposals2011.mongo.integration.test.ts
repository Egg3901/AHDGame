import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import {
  HU_2011_PROPOSALS_COLLECTION,
  openHu2011ElectoralProposal,
  processHu2011ElectoralMandate,
} from "./electoralProposals2011";
import { bindHu2011Campaigns } from "./assemblyCampaignBinding2011";
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

describe.skipIf(!uri)("Hungarian 2011 amendment on isolated Mongo", () => {
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
    const db = client.db(`ahd_test_hu_2011_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "governmentFormations",
      "electedOfficials",
      "bills",
      HU_2011_PROPOSALS_COLLECTION,
      "elections",
      "electionVoteTallies",
      "hu1991AssemblyCounts",
      "npps",
    ])
      await db.createCollection(name);
    await db
      .collection<StringRecord>("gameState")
      .insertOne({ _id: "current", preset: "1991-default", currentTurn: 1005 });
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
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 1005 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    return { db, yes, no };
  }
  async function vote(db: Db, yes: ObjectId, no: ObjectId) {
    const proposal = await openHu2011ElectoralProposal({
      db,
      game: GAME,
      turn: 1005,
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
          votingEndsOnTurn: 1006,
        },
      }
    );
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 1006 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    await processOnePartyBillLifecycleForCountry("HU", NOW);
    return proposal;
  }
  async function primary(db: Db, cycle: number, withVotes = false, primaryEndTurn = 1100) {
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

  it("authorizes from an actual quorate bill without resizing the sitting Assembly", async () => {
    const { db, yes, no } = await fixture();
    try {
      await primary(db, 6);
      await primary(db, 7, true);
      const proposal = await vote(db, yes, no);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "signed"
      );
      commands = commandBytes = replyBytes = 0;
      expect(await processHu2011ElectoralMandate(db, GAME, 1006, NOW)).toBe(true);
      console.info({ fixture: "hu-2011-authorization", commands, commandBytes, replyBytes });
      expect(await processHu2011ElectoralMandate(db, GAME, 1007, NOW)).toBe(false);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralSystem2011SinceTurn
      ).toBe(1006);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
      expect(await bindHu2011Campaigns(db, GAME as never, 1008, NOW)).toBe(false);
      commands = commandBytes = replyBytes = 0;
      expect(await bindHu2011Campaigns(db, GAME as never, 1009, NOW)).toBe(true);
      console.info({ fixture: "hu-2011-primary-binding", commands, commandBytes, replyBytes });
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 6, "hungarianModernAssembly.ruleVersion": "mixed-2011-v1" })
      ).toBe(6);
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 6, hungarianAssemblyRound: { $exists: true } })
      ).toBe(0);
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 7, hungarianAssemblyRound: { $exists: true } })
      ).toBe(6);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each([
    [129, 65],
    [193, 0],
  ])("preserves old law after rejected %i/%i votes", async (forSeats, againstSeats) => {
    const { db, yes, no } = await fixture(forSeats, againstSeats);
    try {
      const proposal = await vote(db, yes, no);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "failed"
      );
      expect(await processHu2011ElectoralMandate(db, GAME, 1006, NOW)).toBe(false);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralSystem2011SinceTurn
      ).toBeUndefined();
    } finally {
      await db.dropDatabase();
    }
  });
});
