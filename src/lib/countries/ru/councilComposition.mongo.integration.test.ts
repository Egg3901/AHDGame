import { writeFile } from "node:fs/promises";
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import {
  materializeRussianCouncilFormationProposal as propose,
  authorizeRussianCouncilFormation as authorize,
} from "./councilFormationProposals";
import { materializeRussianRegionalAuthorities as settle } from "./regionalCouncilAuthorities";
import { materializeRussianCouncilCompositionSeating as seat } from "./councilCompositionSeating";
import { processRussianCouncilComposition as phase } from "./councilCompositionTurn";
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
  "cabinetMembers",
  "russianAssemblySeatings",
  "russianAssemblyOfficeArchives",
  "russianDumaConvocations",
  "russianCouncilFormationProposals",
  "russianRegionalAuthorities",
  "russianCouncilCompositionSeatings",
];
describe.skipIf(!uri)("Regional Council transactions on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    docsRead = 0,
    bytesRead = 0;
  const metrics: Array<{ stage: string; commands: number; docsRead: number; bytesRead: number }> =
    [];
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Council qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => commands++);
    client.on("commandSucceeded", (event) => {
      const rows = event.reply?.cursor?.firstBatch ?? event.reply?.cursor?.nextBatch;
      if (Array.isArray(rows))
        for (const row of rows) {
          docsRead++;
          bytesRead += BSON.calculateObjectSize(row);
        }
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Council qualification requires a writable replica set");
  });
  afterAll(async () => {
    console.info("Council phase read metrics", JSON.stringify(metrics));
    if (process.env.FEDERATION_TEST_COUNCIL_REPORT_PATH)
      await writeFile(
        process.env.FEDERATION_TEST_COUNCIL_REPORT_PATH,
        JSON.stringify(metrics, null, 2) + "\n"
      );
    await client?.close();
  });
  async function fixture() {
    const f = russianAssemblySeatingRuntimeScenario();
    const db = client.db(`ahd_test_council_composition_${new ObjectId().toHexString()}`);
    const nominees = [
      ...f.mem.collection("russianDumaElectionResults").docs[0].nominees,
      ...f.mem.collection("russianCouncilElectionResults").docs[0].nominees,
    ] as Array<{ ownerId: ObjectId; name: string; party: string }>;
    for (const profile of f.mem.collection("npps").docs) {
      const nomination = nominees.find((row) => row.ownerId.equals(profile._id));
      if (!nomination) throw new Error("Fixture profile needs its actual nomination");
      profile.name = nomination.name;
      profile.party = nomination.party;
    }
    f.mem.collection("npps").docs.push({
      _id: new ObjectId(),
      countryId: "RU",
      name: "Existing regional group",
      party: "1",
      money: 500,
      personalAccount: { wealth: 12345, accounts: { USD: 12345, EUR: 200 } },
    });
    for (const name of collections) {
      const rows = f.mem.collection(name).docs;
      if (rows.length) await db.collection(name).insertMany(rows);
      else await db.createCollection(name);
    }
    await runRequiredTransaction(
      (session) => materializeRussianAssemblySeating({ ...f.input, db, session }),
      { client }
    );
    return { db, game: { preset: "1991-default" }, turn: 237, now: new Date(10000) };
  }
  async function enact(
    input: Awaited<ReturnType<typeof fixture>>,
    mode: "regionalHeads" | "regionalDelegates"
  ) {
    const proposal = await runRequiredTransaction(
      (session) => propose({ ...input, mode, sponsor: null, session }),
      { client }
    );
    // Synthetic enactment isolates handover mechanics; statutory vote boundaries have separate tests.
    await input.db
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: input.now } });
    return proposal;
  }
  async function snapshot(db: Db, names = collections) {
    const result: Record<string, string> = {};
    for (const name of names)
      result[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    return result;
  }
  async function measured(stage: string, input: Awaited<ReturnType<typeof fixture>>) {
    commands = docsRead = bytesRead = 0;
    const result = await phase(input);
    metrics.push({ stage, commands, docsRead, bytesRead });
    expect(commands).toBeLessThanOrEqual(100);
    return result;
  }
  it("runs signed heads, regional renewal and separate delegates without rewriting Duma or accounts", async () => {
    const input = await fixture();
    try {
      expect(await measured("no-law", input)).toMatchObject({ authorized: 0, seated: false });
      const other = await input.db
        .collection("electedOfficials")
        .find({ officeType: { $ne: "federationCouncilMember" } })
        .sort({ _id: 1 })
        .toArray();
      const finances = await input.db
        .collection("npps")
        .find({}, { projection: { money: 1, personalAccount: 1 } })
        .sort({ _id: 1 })
        .toArray();
      await enact(input, "regionalHeads");
      expect(await measured("heads-handover", input)).toMatchObject({
        authorized: 1,
        authoritiesChanged: 178,
        seated: true,
      });
      expect(
        await input.db
          .collection("electedOfficials")
          .countDocuments({ officeType: "federationCouncilMember", isAppointment: true })
      ).toBe(178);
      const committed = await snapshot(input.db);
      expect(await measured("heads-steady", { ...input, turn: 238 })).toMatchObject({
        authoritiesChanged: 0,
        seated: false,
      });
      expect(await snapshot(input.db)).toEqual(committed);
      expect(await measured("regional-renewal", { ...input, turn: 429 })).toMatchObject({
        authoritiesChanged: 178,
        seated: true,
      });
      const later = { ...input, turn: 461 };
      await enact(later, "regionalDelegates");
      expect(await measured("delegates-handover", later)).toMatchObject({
        authorized: 1,
        authoritiesChanged: 178,
        seated: true,
      });
      expect(
        await input.db.collection("russianRegionalAuthorities").countDocuments({ termEndTurn: 621 })
      ).toBe(178);
      expect(
        await input.db
          .collection("electedOfficials")
          .find({ officeType: { $ne: "federationCouncilMember" } })
          .sort({ _id: 1 })
          .toArray()
      ).toEqual(other);
      expect(
        await input.db
          .collection("npps")
          .find({}, { projection: { money: 1, personalAccount: 1 } })
          .sort({ _id: 1 })
          .toArray()
      ).toEqual(finances);
      expect(await input.db.collection("countryGameStates").findOne({ _id: "RU" })).toMatchObject({
        ruFederalAssemblySinceTurn: 145,
        ruCouncilComposition: { mode: "regionalDelegates" },
      });
    } finally {
      await input.db.dropDatabase();
    }
  }, 90000);
  it("rolls back late final receipt failure across every collection, then resolves concurrent claims and replay", async () => {
    const input = await fixture();
    try {
      const proposal = await enact(input, "regionalHeads");
      await runRequiredTransaction(
        (session) => authorize({ ...input, session, proposalId: proposal._id }),
        { client }
      );
      const before = await snapshot(input.db);
      await input.db.command({
        collMod: "russianCouncilCompositionSeatings",
        validator: { impossibleQualificationField: { $exists: true } },
        validationLevel: "strict",
      });
      await expect(
        runRequiredTransaction(
          async (session) => {
            await settle({ ...input, session });
            return seat({ ...input, session });
          },
          { client }
        )
      ).rejects.toThrow();
      expect(await snapshot(input.db)).toEqual(before);
      await input.db.command({
        collMod: "russianCouncilCompositionSeatings",
        validator: {},
        validationLevel: "off",
      });
      const results = await Promise.all([phase(input), phase(input)]);
      expect(results.filter((row) => row.seated)).toHaveLength(1);
      expect(await input.db.collection("russianCouncilCompositionSeatings").countDocuments()).toBe(
        1
      );
      const after = await snapshot(input.db);
      expect(await measured("concurrent-replay", { ...input, turn: 238 })).toMatchObject({
        seated: false,
        authoritiesChanged: 0,
      });
      expect(await snapshot(input.db)).toEqual(after);
    } finally {
      await input.db.dropDatabase();
    }
  }, 90000);
});
