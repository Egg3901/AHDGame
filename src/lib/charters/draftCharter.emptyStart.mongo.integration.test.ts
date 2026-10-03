/** Historical party-name filing in an empty start uses real isolated Mongo. */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { draftCharter } from "./draftCharter";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
describe.skipIf(!uri)("1991 empty-start historical party names on isolated Mongo", () => {
  let client: MongoClient;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture() {
    const db = client.db(`ahd_test_empty_party_names_${new ObjectId()}`);
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    await db
      .collection("characters")
      .insertMany(
        founders.map((_id) => ({ _id, userId: new ObjectId(), countryId: "UK", homeState: "NIR" }))
      );
    await db.collection<{ _id: string; [key: string]: unknown }>("gameState").insertOne({
      _id: "current",
      preset: "1991-default",
      startingPartiesMode: "none",
      currentTurn: 50,
    });
    await db
      .collection<{ _id: string; [key: string]: unknown }>("countryGameStates")
      .insertOne({ _id: "UK", enabledForPlayers: true });
    return { db, founders };
  }
  function file(db: Db, founders: ObjectId[]) {
    return draftCharter(
      {
        countryId: "UK",
        proposedName: "Ulster Unionist Party",
        proposedAbbr: "UUP",
        platform: { economic: 0, social: 0 },
        foundersCharacterIds: founders,
        proposedBy: founders[0]!,
        now: new Date("2026-10-04T00:00:00Z"),
      },
      db
    );
  }
  it("records a real UUP charter with its historical abbreviation and prevents a second draft", async () => {
    const { db, founders } = await fixture();
    try {
      expect((await file(db, founders)).ok).toBe(true);
      const charter = await db.collection("partyCharters").findOne();
      expect(charter).toMatchObject({
        countryId: "UK",
        proposedName: "Ulster Unionist Party",
        proposedAbbr: "UUP",
        status: "pending-signatures",
        expiresOnTurn: expect.any(Number),
      });
      expect(await db.collection("partyCharters").countDocuments()).toBe(1);
      expect(await file(db, founders)).toEqual({ ok: false, reason: "abbreviation-taken" });
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["default", "background", "existingParty"])(
    "keeps the %s reservation or collision protection",
    async (mode) => {
      const { db, founders } = await fixture();
      try {
        if (mode === "default")
          await db
            .collection<{ _id: string; [key: string]: unknown }>("gameState")
            .updateOne({ _id: "current" }, { $set: { startingPartiesMode: "default" } });
        if (mode === "background")
          await db
            .collection<{ _id: string; [key: string]: unknown }>("countryGameStates")
            .updateOne({ _id: "UK" }, { $set: { enabledForPlayers: false } });
        if (mode === "existingParty")
          await db
            .collection("politicalParties")
            .insertOne({ countryId: "UK", name: "Ulster Unionist Party", abbreviation: "UUP" });
        expect(await file(db, founders)).toEqual({ ok: false, reason: "abbreviation-taken" });
        expect(await db.collection("partyCharters").countDocuments()).toBe(0);
      } finally {
        await db.dropDatabase();
      }
    }
  );
});
