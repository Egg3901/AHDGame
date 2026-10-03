/** Shared financial owners are not the individual deputies on native slates. */
import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NPP } from "@/lib/db/types";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { processNppMortality } from "./mortality";
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({ nppAutonomyAtLeast: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z");
describe.skipIf(!uri)("Native slate custody through actual mortality processing", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (e) => {
      commands++;
      requestBytes += BSON.calculateObjectSize(e.command);
    });
    client.on("commandSucceeded", (e) => {
      replyBytes += BSON.calculateObjectSize({ reply: e.reply }) - 12;
    });
    await client.connect();
    vi.mocked(nppAutonomyAtLeast).mockResolvedValue(true);
  });
  afterAll(async () => {
    await client?.close();
  });
  async function fixture(countryId: "BG" | "HU", seats: number, native: boolean) {
    const db = client.db(`ahd_test_native_mortality_${new ObjectId()}`),
      ownerId = new ObjectId();
    await db.collection("npps").insertOne({
      _id: ownerId,
      countryId,
      homeState: "region",
      party: "a",
      birthYear: 1900,
      balance: 777,
      currentOffice: { type: "assemblyDeputy", state: "region", seatsHeld: seats },
      seatsHeld: seats,
    });
    await db.collection("electedOfficials").insertMany(
      Array.from({ length: seats }, (_, index) => ({
        countryId,
        nppId: ownerId,
        characterId: null,
        officeType: countryId === "BG" ? "assemblyDeputy" : "assemblyDelegate",
        seatsHeld: 1,
        ...(native
          ? {
              [countryId === "BG" ? "bulgarianFoundingMandate" : "hungarianAssemblyMandate"]: {
                receiptId: "native-test",
                personId: `person-${index}`,
                tier: "list",
                districtId: "district",
                rootCandidateId: "campaign",
              },
            }
          : {}),
        stableField: "preserve",
      }))
    );
    await db
      .collection("electionCandidates")
      .insertOne({ countryId, nppId: ownerId, status: "active" });
    await db
      .collection<{ _id: string; pmNppId: ObjectId; pmName: string }>("governmentFormations")
      .insertOne({ _id: countryId, pmNppId: ownerId, pmName: "Original" });
    return { db, ownerId };
  }
  async function run(
    db: Db,
    rng = vi.fn(() => 0),
    mint = vi.fn(async (dead: NPP) => ({
      ...dead,
      _id: new ObjectId(),
      name: "Random replacement",
      birthYear: 1950,
    }))
  ) {
    const result = await processNppMortality(db, {
      now: NOW,
      year: 1991,
      rng,
      mintReplacement: mint,
    });
    return { result, rng, mint };
  }
  it.each([
    ["BG", 400],
    ["HU", 386],
    ["BG", 1],
    ["HU", 1],
  ] as const)(
    "preserves%s financial custody for%d original people without minting",
    async (country, seats) => {
      const { db, ownerId } = await fixture(country, seats, true);
      try {
        const before = await db.collection("electedOfficials").find().sort({ _id: 1 }).toArray(),
          ownerBefore = await db.collection("npps").findOne({ _id: ownerId }),
          formationBefore = await db.collection("governmentFormations").findOne({});
        commands = requestBytes = replyBytes = 0;
        const { result, rng, mint } = await run(db);
        const metrics = { commands, requestBytes, replyBytes };
        process.stdout.write(
          JSON.stringify({ path: `native-${country}-${seats}`, ...metrics }) + "\n"
        );
        expect(result).toEqual({ deaths: 0, replacements: 0 });
        expect(rng).not.toHaveBeenCalled();
        expect(mint).not.toHaveBeenCalled();
        expect(metrics.commands).toBe(2);
        expect(await db.collection("electedOfficials").find().sort({ _id: 1 }).toArray()).toEqual(
          before
        );
        expect(await db.collection("npps").findOne({ _id: ownerId })).toEqual(ownerBefore);
        expect(await db.collection("governmentFormations").findOne({})).toEqual(formationBefore);
        expect((await db.collection("electionCandidates").findOne({}))?.status).toBe("active");
        expect(await db.collection("npps").countDocuments()).toBe(1);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each(["BG", "HU"] as const)(
    "retains%s legacy death, office and PM succession",
    async (country) => {
      const { db, ownerId } = await fixture(country, 1, false);
      try {
        const { result, mint } = await run(db);
        expect(result).toEqual({ deaths: 1, replacements: 1 });
        expect(mint).toHaveBeenCalledTimes(1);
        const successor = await db.collection("npps").findOne({ _id: { $ne: ownerId } });
        expect(successor).toBeTruthy();
        expect((await db.collection("electedOfficials").findOne({}))?.nppId).toEqual(
          successor!._id
        );
        expect((await db.collection("governmentFormations").findOne({}))?.pmNppId).toEqual(
          successor!._id
        );
        expect((await db.collection("electionCandidates").findOne({}))?.status).toBe("withdrawn");
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it("does not exempt a financial owner after its last native mandate is gone", async () => {
    const { db } = await fixture("BG", 1, true);
    try {
      await db.collection("electedOfficials").updateMany({}, { $set: { seatsHeld: 0 } });
      expect((await run(db)).result).toEqual({ deaths: 1, replacements: 1 });
    } finally {
      await db.dropDatabase();
    }
  });
});
