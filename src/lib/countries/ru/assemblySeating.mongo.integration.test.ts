import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import {
  materializeRussianAssemblySeating,
  RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION,
} from "./assemblySeating";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
type Fixture = { _id: string | ObjectId; [key: string]: unknown };
describe.skipIf(!uri)("Assembly handover on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Assembly qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => {
      commands += 1;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Assembly qualification requires a writable replica-set primary");
  });
  afterAll(async () => {
    await client?.close();
  });
  it("rolls back every handover write on late receipt rejection, then retries and replays in bounded commands", async () => {
    const db = client.db(`ahd_test_assembly_${new ObjectId().toHexString()}`);
    try {
      const { mem, input } = russianAssemblySeatingRuntimeScenario();
      for (const [name, collection] of mem.collections)
        if (collection.docs.length)
          await db.collection<Fixture>(name).insertMany(collection.docs as Fixture[]);
      await db.createCollection(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION, {
        validator: { preset: "reject-late-receipt" },
      });
      const oldCongress = await db
        .collection("electedOfficials")
        .find({ officeType: "congressDeputy" })
        .toArray();
      const oldProfiles = await db.collection("npps").find({}).toArray();
      const oldRegions = await db.collection("states").find({}).toArray();
      const oldFormation = await db
        .collection<Fixture>("governmentFormations")
        .findOne({ _id: "RU" });
      const seat = () =>
        runRequiredTransaction(
          (session) => materializeRussianAssemblySeating({ ...input, db, session }),
          { client }
        );
      await expect(seat()).rejects.toMatchObject({ code: 121 });
      expect(
        await db.collection("electedOfficials").find({ officeType: "congressDeputy" }).toArray()
      ).toEqual(oldCongress);
      expect(
        await db
          .collection("electedOfficials")
          .countDocuments({ officeType: { $in: ["dumaDeputy", "federationCouncilMember"] } })
      ).toBe(0);
      expect(await db.collection("russianAssemblyOfficeArchives").countDocuments()).toBe(0);
      expect(await db.collection("npps").find({}).toArray()).toEqual(oldProfiles);
      expect(await db.collection("states").find({}).toArray()).toEqual(oldRegions);
      expect(await db.collection<Fixture>("governmentFormations").findOne({ _id: "RU" })).toEqual(
        oldFormation
      );
      expect(
        await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
      ).not.toHaveProperty("ruFederalAssemblySinceTurn");
      expect(
        await db
          .collection("russianDumaElectionResults")
          .countDocuments({ seatedOnTurn: { $exists: true } })
      ).toBe(0);
      expect(
        await db
          .collection("russianCouncilElectionResults")
          .countDocuments({ seatedOnTurn: { $exists: true } })
      ).toBe(0);
      await db.command({ collMod: RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION, validator: {} });
      commands = 0;
      expect(await seat()).toBe(true);
      expect(commands).toBeLessThanOrEqual(26);
      expect(await db.collection(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION).countDocuments()).toBe(1);
      expect(
        await db.collection("electedOfficials").countDocuments({ officeType: "dumaDeputy" })
      ).toBe(228);
      expect(
        await db
          .collection("electedOfficials")
          .countDocuments({ officeType: "federationCouncilMember" })
      ).toBe(178);
      expect(
        await db.collection("electedOfficials").countDocuments({ officeType: "congressDeputy" })
      ).toBe(0);
      const offices = await db.collection("electedOfficials").find({}).toArray();
      expect(new Set(offices.map((row) => row._id.toHexString())).size).toBe(offices.length);
      expect(
        (await db.collection("npps").find({}).toArray()).every(
          (row) =>
            row.money === 500 &&
            row.personalAccount.wealth === 12345 &&
            row.personalAccount.accounts.EUR === 200
        )
      ).toBe(true);
      expect(
        await db.collection("russianDumaElectionResults").countDocuments({ seatedOnTurn: 145 })
      ).toBe(1);
      expect(
        await db.collection("russianCouncilElectionResults").countDocuments({ seatedOnTurn: 145 })
      ).toBe(1);
      commands = 0;
      expect(await seat()).toBe(false);
      expect(commands).toBeLessThanOrEqual(3);
      expect(await db.collection("electedOfficials").find({}).toArray()).toEqual(offices);
    } finally {
      await db.dropDatabase();
    }
  });
  it("allows exactly one of two concurrent handovers to claim the chambers", async () => {
    const db = client.db(`ahd_test_assembly_${new ObjectId().toHexString()}`);
    try {
      const { mem, input } = russianAssemblySeatingRuntimeScenario();
      for (const [name, collection] of mem.collections)
        if (collection.docs.length)
          await db.collection<Fixture>(name).insertMany(collection.docs as Fixture[]);
      const seat = () =>
        runRequiredTransaction(
          (session) => materializeRussianAssemblySeating({ ...input, db, session }),
          { client }
        );
      expect((await Promise.all([seat(), seat()])).sort()).toEqual([false, true]);
      expect(await db.collection(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION).countDocuments()).toBe(1);
      expect(await db.collection("russianAssemblyOfficeArchives").countDocuments()).toBe(1);
      expect(
        await db.collection("electedOfficials").countDocuments({ officeType: "dumaDeputy" })
      ).toBe(228);
      expect(
        await db
          .collection("electedOfficials")
          .countDocuments({ officeType: "federationCouncilMember" })
      ).toBe(178);
      expect(
        (await db.collection("npps").find({}).toArray()).every(
          (row) =>
            row.money === 500 &&
            row.personalAccount.wealth === 12345 &&
            row.personalAccount.accounts.EUR === 200
        )
      ).toBe(true);
    } finally {
      await db.dropDatabase();
    }
  });
});
