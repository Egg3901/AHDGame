import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { bgRegions1991 } from "./data/bgRegions1991";
import { bindBgFoundingCampaigns } from "./foundingCampaignBinding1990";
import { certifyBgFoundingFirstCount, BG_FOUNDING_COUNTS_COLLECTION } from "./foundingCount1990";
import { seatBgFoundingAssembly } from "./foundingSeating1990";
import { openBgFoundingRunoff, certifyBgFoundingRunoff } from "./foundingRunoff1990";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { registerBgFoundingPlayerFiling } from "./foundingPlayerFiling1990";
import { BG_1990_CONSTITUENCIES } from "./data/foundingDistricts1990";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/news", () => ({ generateElectionNews: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/election/electionNotifications", () => ({
  sendBatchedElectionResults: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAuditBulk: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const now = new Date("1991-01-01T00:00:00Z");
type StringRecord = { _id: string; [key: string]: unknown };

describe.skipIf(!uri)("Bulgarian founding parallel election on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Qualification requires loopback Mongo");
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
      throw new Error("Qualification requires a writable replica set");
    vi.mocked(getMongoClient).mockResolvedValue(client);
  });
  afterAll(async () => {
    await client?.close();
  });

  async function fixture(lowTurnout = false) {
    const db = client.db(`ahd_test_bg_founding_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryGameStates",
      "states",
      "stateRegistrationPool",
      "governmentFormations",
      "elections",
      "electionCandidates",
      "electionVoteTallies",
      "npps",
      "characters",
      "electedOfficials",
      "bankAccounts",
      "notifications",
      "campaigns",
      BG_FOUNDING_COUNTS_COLLECTION,
      "bgFoundingAssemblyOfficeArchives",
      "bgFoundingAssemblyFilingLocks",
      "politicalParties",
    ])
      await db.createCollection(name);
    await db
      .collection<StringRecord>("gameState")
      .insertOne({ _id: "current", preset: "1991-default", currentTurn: 10 });
    await db.collection<StringRecord>("countryGameStates").insertOne({ _id: "BG" });
    await db
      .collection<StringRecord>("governmentFormations")
      .insertOne({ _id: "BG", totalSeats: 400, majorityThreshold: 201 });
    await db
      .collection<StringRecord>("states")
      .insertMany(bgRegions1991.map((row) => ({ ...row, votingEligiblePopulation: 100000 })));
    const human = new ObjectId();
    await db.collection("characters").insertOne({
      _id: human,
      countryId: "BG",
      party: "A",
      userId: new ObjectId(),
      currentOffice: null,
      careerHistory: [],
    });
    const electionIds: ObjectId[] = [];
    for (const [index, region] of bgRegions1991.entries()) {
      const electionId = new ObjectId();
      electionIds.push(electionId);
      const candidates = ["A", "B"].map((party, order) => ({
        _id: new ObjectId(),
        electionId,
        countryId: "BG",
        nppId: new ObjectId(),
        characterId: new ObjectId(),
        isNPP: true,
        characterName: `Synthetic ${region._id} ${party}`,
        party,
        status: "active",
        enteredAt: new Date(now.getTime() + order + 1),
      }));
      await db.collection("npps").insertMany(
        candidates.map((row) => ({
          _id: row.nppId,
          countryId: "BG" as const,
          party: row.party,
          retiredAt: null,
          isTechnocrat: false,
          currentOffice: null,
          balance: 1000,
        }))
      );
      const player = {
        _id: new ObjectId(),
        electionId,
        countryId: "BG",
        characterId: human,
        isNPP: false,
        characterName: "Synthetic player",
        party: "A",
        status: "active",
        enteredAt: now,
      };
      const nominees = index === 0 ? [...candidates, player] : candidates;
      await db.collection("electionCandidates").insertMany(nominees);
      await db.collection("elections").insertOne({
        _id: electionId,
        countryId: "BG",
        electionType: "nationalAssembly",
        state: region._id,
        totalSeats: region.houseDistricts,
        cycle: 0,
        electionYear: 1990,
        status: "completed",
        endTurn: 9,
        endTime: now,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("electionVoteTallies").insertOne({
        _id: new ObjectId(),
        electionId,
        state: region._id,
        totalVotes: Object.fromEntries(
          nominees.map((row) => [
            row._id.toHexString(),
            row.party === "B"
              ? lowTurnout
                ? 15000
                : 30000
              : row.isNPP
                ? lowTurnout
                  ? 25000
                  : 50000
                : 0,
          ])
        ),
        candidateNames: Object.fromEntries(
          nominees.map((row) => [row._id.toHexString(), row.characterName])
        ),
        candidateParties: Object.fromEntries(
          nominees.map((row) => [row._id.toHexString(), row.party])
        ),
        turnSnapshots: [],
        finalized: false,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("campaigns").insertMany(
        nominees.map((row) => ({
          _id: new ObjectId(),
          electionId,
          candidateId: row.isNPP ? (row as (typeof candidates)[number]).nppId : human,
          balance: 100,
          status: "active",
        }))
      );
    }
    await db
      .collection("bankAccounts")
      .insertOne({ _id: new ObjectId(), ownerId: human, balance: 123456 });
    vi.mocked(getDb).mockResolvedValue(db);
    return { db, human, electionIds };
  }

  it("normal resolution binds cycle zero and installs400 individual mandates with one player and unchanged money", async () => {
    const { db, human } = await fixture();
    try {
      const before = await db.collection("bankAccounts").find().toArray();
      commands = 0;
      requestBytes = 0;
      replyBytes = 0;
      expect(await resolveGeneralElections(now)).toBe(5);
      process.stdout.write(
        `${JSON.stringify({ profile: "bg-founding-native", commands, requestBytes, replyBytes })}\n`
      );
      expect(commands).toBeLessThan(70);
      expect(
        await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDeputy" })
      ).toBe(400);
      expect(await db.collection("electedOfficials").countDocuments({ characterId: human })).toBe(
        1
      );
      expect(await db.collection("npps").countDocuments()).toBe(10);
      expect(await db.collection("bankAccounts").find().toArray()).toEqual(before);
      expect(
        await db
          .collection("electionVoteTallies")
          .countDocuments({ finalized: true, resolutionPath: "bg_founding_parallel" })
      ).toBe(5);
      expect(await resolveGeneralElections(now)).toBe(0);
      expect(await db.collection("notifications").countDocuments()).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it("missing a peer leaves all offices intact and retry seats the whole chamber", async () => {
    const { db, electionIds } = await fixture();
    try {
      await db
        .collection("elections")
        .updateOne({ _id: electionIds[0] }, { $set: { status: "active" } });
      expect(await resolveGeneralElections(now)).toBe(0);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(0);
      await db
        .collection("elections")
        .updateOne({ _id: electionIds[0] }, { $set: { status: "completed" } });
      expect(await resolveGeneralElections(now)).toBe(5);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
    } finally {
      await db.dropDatabase();
    }
  });
  it("rolls back a failed late write, then concurrent retries commit one chamber", async () => {
    const { db } = await fixture();
    try {
      expect(await bindBgFoundingCampaigns(db, now)).toBe(5);
      expect((await certifyBgFoundingFirstCount(db, 0, 10, now))?.count.kind).toBe("certified");
      await db.collection("governmentFormations").deleteMany({});
      await expect(seatBgFoundingAssembly(db, 0, 10, now)).rejects.toThrow("government formation");
      expect(await db.collection("electedOfficials").countDocuments()).toBe(0);
      expect(await db.collection("notifications").countDocuments()).toBe(0);
      expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
        0
      );
      await db
        .collection<StringRecord>("governmentFormations")
        .insertOne({ _id: "BG", totalSeats: 400 });
      const outcomes = await Promise.all([
        seatBgFoundingAssembly(db, 0, 10, now),
        seatBgFoundingAssembly(db, 0, 10, now),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
    } finally {
      await db.dropDatabase();
    }
  });
  it("opens a real runoff, preserves first votes and account balances, and seats only after new ballots", async () => {
    const { db } = await fixture(true);
    try {
      await bindBgFoundingCampaigns(db, now);
      const first = await certifyBgFoundingFirstCount(db, 0, 10, now);
      expect(first?.count.unresolved).toHaveLength(200);
      const campaigns = await db.collection("campaigns").find().toArray();
      const ids = await openBgFoundingRunoff(db, 0, 10, now);
      expect(ids).toHaveLength(5);
      expect(await openBgFoundingRunoff(db, 0, 10, now)).toEqual(ids);
      expect(await db.collection("campaigns").countDocuments()).toBe(campaigns.length);
      expect((await db.collection("campaigns").find().toArray()).map((row) => row.balance)).toEqual(
        campaigns.map((row) => row.balance)
      );
      expect(await seatBgFoundingAssembly(db, 0, 10, now)).toBe(false);
      for (const id of ids) {
        const electionId = new ObjectId(id);
        const nominees = await db.collection("electionCandidates").find({ electionId }).toArray();
        await db.collection("electionVoteTallies").updateOne(
          { electionId },
          {
            $set: {
              totalVotes: Object.fromEntries(
                nominees.map((row) => [
                  row._id.toHexString(),
                  row.party === "B" ? 20000 : row.isNPP ? 10000 : 0,
                ])
              ),
              candidateParties: Object.fromEntries(
                nominees.map((row) => [row._id.toHexString(), row.party])
              ),
            },
          }
        );
        await db
          .collection("elections")
          .updateOne({ _id: electionId }, { $set: { status: "completed" } });
      }
      expect(await certifyBgFoundingRunoff(db, 0, 12, now)).toBe(true);
      const frozen = await certifyBgFoundingFirstCount(db, 0, 12, now);
      expect(frozen?.first).toEqual(first?.first);
      expect(frozen?.count.lists).toEqual(first?.count.lists);
      expect(frozen?.count.kind).toBe("certified");
      expect(await seatBgFoundingAssembly(db, 0, 12, now)).toBe(true);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(400);
    } finally {
      await db.dropDatabase();
    }
  });
  it("reserves one constituency atomically and re-entry preserves the original candidacy", async () => {
    const { db, electionIds } = await fixture();
    try {
      await bindBgFoundingCampaigns(db, now);
      const race = await db.collection("elections").findOne({ _id: electionIds[0] });
      const district = BG_1990_CONSTITUENCIES.find((row) => row.regionId === race!.state)!;
      await db
        .collection("elections")
        .updateOne({ _id: race!._id }, { $set: { status: "active", primaryEndTurn: 20 } });
      await db
        .collection("politicalParties")
        .insertOne({ countryId: "BG", sequentialId: 1, regimeStatus: "approved" });
      const owners = [new ObjectId(), new ObjectId()];
      await db.collection("characters").insertMany(
        owners.map((_id) => ({
          _id,
          countryId: "BG",
          homeState: race!.state,
          party: "1",
          currentOffice: null,
        }))
      );
      const inputs = owners.map((characterId) => ({
        db,
        electionId: race!._id,
        candidate: {
          electionId: race!._id,
          countryId: "BG" as const,
          characterId,
          characterName: "Synthetic filer",
          party: "1",
          status: "active" as const,
          support: 0,
          enteredAt: now,
        },
        requestedDistrictId: district.id,
        turn: 10,
        now,
      }));
      const results = await Promise.all(
        inputs.map((input) => registerBgFoundingPlayerFiling(input))
      );
      expect(results.filter((row) => row.allowed)).toHaveLength(1);
      const success = results.find((row) => row.allowed)!;
      if (!success.allowed) throw new Error("Missing successful filer");
      const original = await db
        .collection("electionCandidates")
        .findOne({ _id: success.insertedId });
      const input = inputs.find((row) => row.candidate.characterId.equals(original!.characterId))!;
      await db
        .collection("electionCandidates")
        .updateOne({ _id: success.insertedId }, { $set: { status: "withdrawn" } });
      const reentered = await registerBgFoundingPlayerFiling(input);
      expect(reentered).toEqual(success);
      expect(await db.collection("bgFoundingAssemblyFilingLocks").countDocuments()).toBe(2);
    } finally {
      await db.dropDatabase();
    }
  });
});
