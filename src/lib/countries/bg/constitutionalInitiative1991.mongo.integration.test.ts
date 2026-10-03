import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import { bgRegions1991 } from "./data/bgRegions1991";
import {
  endorseBg1991ConstitutionalInitiative,
  loadBg1991ConstitutionalDecision,
} from "./constitutionalProposals1991";
import { BG_1991_INITIATIVES_COLLECTION } from "./constitutionalInitiative1991";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const game = { preset: "1991-default" },
  now = new Date("2026-10-03T00:00:00Z");
type Row = { _id: string; [key: string]: unknown };
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
describe.skipIf(!uri)("Bulgarian collective initiative on actual Mongo", () => {
  let client: MongoClient,
    commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const url = new URL(uri!);
    if (url.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Explicit isolated loopback Mongo required");
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
      throw new Error("Writable replica set required");
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture() {
    const db = client.db(`ahd_test_bg_initiative_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "states",
      "electedOfficials",
      "npps",
      "bills",
      "bg1991ConstitutionalProposals",
      BG_1991_INITIATIVES_COLLECTION,
    ])
      await db.createCollection(name);
    await db.collection<Row>("gameState").insertOne({ _id: "current", ...game, currentTurn: 25 });
    await db
      .collection<Row>("countryState")
      .insertOne({ _id: "BG", governmentType: "parliamentaryRepublic" });
    await db.collection<Row>("countryGameStates").insertOne({ _id: "BG" });
    await db.collection<Row>("states").insertMany(bgRegions1991.map((row) => ({ ...row })));
    const first = { _id: new ObjectId(), name: "Synthetic Deputy One" },
      second = { _id: new ObjectId(), name: "Synthetic Deputy Two" },
      ally = new ObjectId(),
      opposition = new ObjectId();
    await db.collection("npps").insertMany([
      { _id: ally, party: "1", personality: { loyalty: 100, stubbornness: 0 }, balance: 777 },
      { _id: opposition, party: "2", balance: 888 },
    ]);
    await db.collection("electedOfficials").insertMany([
      {
        countryId: "BG",
        officeType: "assemblyDeputy",
        characterId: first._id,
        seatsHeld: 1,
        party: "1",
      },
      { countryId: "BG", officeType: "assemblyDeputy", nppId: ally, seatsHeld: 98, party: "1" },
      {
        countryId: "BG",
        officeType: "assemblyDeputy",
        nppId: opposition,
        seatsHeld: 301,
        party: "2",
      },
    ]);
    const owners = await db.collection("npps").find().toArray();
    const endorse = (sponsor = first, turn = 25) =>
      endorseBg1991ConstitutionalInitiative({
        db,
        game,
        turn,
        now,
        sponsor,
        sponsorParty: "invented",
      });
    const addSecond = async () => {
      await db
        .collection("electedOfficials")
        .updateOne({ nppId: opposition }, { $set: { seatsHeld: 300 } });
      await db.collection("electedOfficials").insertOne({
        countryId: "BG",
        officeType: "assemblyDeputy",
        characterId: second._id,
        seatsHeld: 1,
        party: "1",
      });
    };
    vi.mocked(getDb).mockResolvedValue(db);
    return { db, first, second, owners, endorse, addSecond, ally, opposition };
  }
  it("collects99 then introduces at100, keeps normal consent separate and starts rejected revisions without old signatures", async () => {
    const f = await fixture();
    try {
      for (let attempt = 0; attempt < 2; attempt++)
        expect((await f.endorse()).initiative.support).toBe(99);
      expect(await f.db.collection("bills").countDocuments()).toBe(0);
      await f.addSecond();
      commands = requestBytes = replyBytes = 0;
      const result = await f.endorse(f.second);
      process.stdout.write(
        JSON.stringify({ fixture: "bg-quarter-introduction", commands, requestBytes, replyBytes }) +
          "\n"
      );
      expect(result.initiative.support).toBe(100);
      expect(result.proposal?.reason).toBe("deputy_quarter_initiative");
      expect(
        await f.db.collection("bills").findOne({ _id: result.proposal!.billId })
      ).toMatchObject({ status: "proposed", sponsorParty: "1" });
      expect(
        await f.db.collection<Row>("countryGameStates").findOne({ _id: "BG" })
      ).not.toHaveProperty("bgConstitution1991SinceTurn");
      expect((await loadBg1991ConstitutionalDecision(f.db, game, 25))?.initiative.support).toBe(
        100
      );
      vi.mocked(getGameState).mockResolvedValue({ ...game, currentTurn: 25 } as Awaited<
        ReturnType<typeof getGameState>
      >);
      await processOnePartyBillLifecycleForCountry("BG", now);
      await f.db.collection("bills").updateOne(
        { _id: result.proposal!.billId },
        {
          $set: {
            votes: {
              [f.first._id.toHexString()]: "for",
              [f.second._id.toHexString()]: "for",
              [`npp_${f.ally}`]: "for",
              [`npp_${f.opposition}`]: "against",
            },
            votingEndsOnTurn: 26,
          },
        }
      );
      vi.mocked(getGameState).mockResolvedValue({ ...game, currentTurn: 26 } as Awaited<
        ReturnType<typeof getGameState>
      >);
      await processOnePartyBillLifecycleForCountry("BG", now);
      expect(
        await f.db.collection("bills").findOne({ _id: result.proposal!.billId })
      ).toMatchObject({
        status: "failed",
        voteSnapshot: { totals: { for: 100, against: 300, abstain: 0 } },
      });
      expect((await loadBg1991ConstitutionalDecision(f.db, game, 25))?.initiative.support).toBe(0);
      await expect(f.endorse()).rejects.toThrow("cannot precede");
      expect((await f.endorse(f.first, 27)).initiative.support).toBe(99);
      expect(await f.db.collection("bills").countDocuments()).toBe(1);
      expect(await f.db.collection("npps").find().toArray()).toEqual(f.owners);
    } finally {
      await f.db.dropDatabase();
    }
  });
  it("rolls back the threshold signature if bill publication fails, then introduces once under concurrency", async () => {
    const f = await fixture();
    try {
      await f.endorse();
      await f.addSecond();
      await f.db.command({ collMod: "bills", validator: { impossible: { $exists: true } } });
      await expect(f.endorse(f.second)).rejects.toThrow();
      expect((await loadBg1991ConstitutionalDecision(f.db, game, 25))?.initiative.support).toBe(99);
      expect(await f.db.collection("bg1991ConstitutionalProposals").countDocuments()).toBe(0);
      await f.db.command({ collMod: "bills", validator: {} });
      const results = await Promise.allSettled([f.endorse(f.second), f.endorse(f.second)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await f.db.collection("bills").countDocuments()).toBe(1);
      expect((await loadBg1991ConstitutionalDecision(f.db, game, 25))?.initiative.support).toBe(
        100
      );
      expect(await f.db.collection("npps").find().toArray()).toEqual(f.owners);
    } finally {
      await f.db.dropDatabase();
    }
  });

  it("never combines signatures for different transitional drafts", async () => {
    const f = await fixture();
    try {
      expect((await f.endorse()).initiative.support).toBe(99);
      await f.addSecond();
      const continued = await endorseBg1991ConstitutionalInitiative({
        db: f.db,
        game,
        turn: 25,
        now,
        sponsor: f.second,
        disposition: "continue",
      });
      expect(continued.initiative.support).toBe(99);
      expect(continued.proposal).toBeNull();
      expect(await f.db.collection("bills").countDocuments()).toBe(0);
      const selected = await loadBg1991ConstitutionalDecision(f.db, game, 25);
      expect(selected?.initiatives).toMatchObject({
        dissolve: { support: 99 },
        continue: { support: 99 },
      });
      const result = await endorseBg1991ConstitutionalInitiative({
        db: f.db,
        game,
        turn: 25,
        now,
        sponsor: f.first,
        disposition: "continue",
      });
      expect(result.proposal?.disposition).toBe("continue");
      expect(
        (await f.db.collection("bills").findOne({ _id: result.proposal!.billId }))
          ?.bulgarianConstitutionalMandate
      ).toMatchObject({ disposition: "continue", kind: "constitution1991" });
      expect(await f.db.collection("npps").find().toArray()).toEqual(f.owners);
    } finally {
      await f.db.dropDatabase();
    }
  });

  it("uses current mandate custody and the canonical pre-iteration calendar", async () => {
    const f = await fixture();
    try {
      await f.endorse();
      await f.addSecond();
      await f.db.collection("electedOfficials").deleteOne({ characterId: f.first._id });
      expect((await f.endorse(f.second)).initiative.support).toBe(99);
      expect(await f.db.collection("bills").countDocuments()).toBe(0);
      await f.db
        .collection<Row>("gameState")
        .updateOne(
          { _id: "current" },
          { $set: { preIteration: { active: true }, preIterationTurns: 100 } }
        );
      await expect(f.endorse(f.second)).rejects.toThrow();
      await f.db
        .collection<Row>("gameState")
        .updateOne({ _id: "current" }, { $unset: { preIteration: "", preIterationTurns: "" } });
      await f.db
        .collection<Row>("countryGameStates")
        .updateOne({ _id: "BG" }, { $set: { dissolvedTurn: 25 } });
      await expect(f.endorse(f.second)).rejects.toThrow("no-legislature");
    } finally {
      await f.db.dropDatabase();
    }
  });
});
