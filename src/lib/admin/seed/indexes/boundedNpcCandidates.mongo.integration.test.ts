import { MongoClient, ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureBoundedNpcCandidateGuards as migrate } from "./boundedNpcCandidates";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const legacyName = "unique_active_election_candidate_per_character";
describe.skipIf(!uri)("Bounded NPC candidacy guards on isolated Mongo", () => {
  let client: MongoClient;
  let databaseName: string;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Candidacy qualification requires an explicit loopback database");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Writable test replica set required");
  });
  beforeEach(async () => {
    databaseName = `ahd_test_nominee_${new ObjectId().toHexString()}`;
    await client
      .db(databaseName)
      .collection("electionCandidates")
      .createIndex(
        { characterId: 1 },
        {
          name: legacyName,
          unique: true,
          partialFilterExpression: { status: "active" },
        }
      );
  });
  afterEach(async () => {
    await client.db(databaseName).dropDatabase();
  });
  afterAll(async () => {
    await client?.close();
  });
  it("permits distinct bounded NPC nominees while retaining player and ordinary NPC guards", async () => {
    const db = client.db(databaseName);
    await migrate(db);
    const candidates = db.collection("electionCandidates");
    const npc = new ObjectId();
    await candidates.insertMany(
      [1, 2].map(() => ({
        characterId: npc,
        isNPP: true,
        status: "active",
        boundedNpcNomineeId: new ObjectId(),
      }))
    );
    const player = new ObjectId();
    await candidates.insertOne({
      characterId: player,
      isNPP: false,
      status: "active",
      boundedNpcNomineeId: new ObjectId(),
    });
    await expect(
      candidates.insertOne({
        characterId: player,
        isNPP: false,
        status: "active",
        boundedNpcNomineeId: new ObjectId(),
      })
    ).rejects.toMatchObject({ code: 11000 });
    const legacyPlayer = new ObjectId();
    await candidates.insertOne({ characterId: legacyPlayer, status: "active" });
    await expect(
      candidates.insertOne({
        characterId: legacyPlayer,
        status: "active",
        boundedNpcNomineeId: new ObjectId(),
      })
    ).rejects.toMatchObject({ code: 11000 });
    const ordinaryNpc = new ObjectId();
    await candidates.insertOne({ characterId: ordinaryNpc, isNPP: true, status: "active" });
    await expect(
      candidates.insertOne({ characterId: ordinaryNpc, isNPP: true, status: "active" })
    ).rejects.toMatchObject({ code: 11000 });
    await migrate(db);
    expect((await candidates.indexes()).some((index) => index.name === legacyName)).toBe(false);
  });
  it("retains the legacy guard when duplicate virtual identities prevent replacement creation", async () => {
    const db = client.db(databaseName);
    const candidates = db.collection("electionCandidates");
    const virtual = new ObjectId();
    const second = new ObjectId();
    await candidates.insertMany([
      { characterId: new ObjectId(), isNPP: true, status: "active", boundedNpcNomineeId: virtual },
      {
        _id: second,
        characterId: new ObjectId(),
        isNPP: true,
        status: "active",
        boundedNpcNomineeId: virtual,
      },
    ]);
    await expect(migrate(db)).rejects.toMatchObject({ code: 11000 });
    expect((await candidates.indexes()).some((index) => index.name === legacyName)).toBe(true);
    await candidates.updateOne({ _id: second }, { $set: { status: "withdrawn" } });
    await migrate(db);
    expect((await candidates.indexes()).some((index) => index.name === legacyName)).toBe(false);
  });
  it("rejects an unexpected replacement index instead of silently accepting its name", async () => {
    const db = client.db(databaseName);
    const candidates = db.collection("electionCandidates");
    await candidates.createIndex(
      { characterId: 1 },
      { name: "unique_active_player_or_unbounded_npc_candidate" }
    );
    await expect(migrate(db)).rejects.toThrow();
    expect((await candidates.indexes()).some((index) => index.name === legacyName)).toBe(true);
  });
});
