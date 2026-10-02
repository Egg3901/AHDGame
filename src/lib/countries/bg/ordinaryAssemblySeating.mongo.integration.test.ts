import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bgRegions1991 } from "./data/bgRegions1991";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";
import {
  readBgOrdinaryElectionPlan,
  BG_ORDINARY_PLANS_COLLECTION,
} from "@/lib/turn/election/bgOrdinaryEligibility";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { getDb, getMongoClient } from "@/lib/mongodb";

vi.mock("@/lib/news", () => ({ generateElectionNews: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/election/electionNotifications", () => ({
  sendBatchedElectionResults: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAuditBulk: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const now = new Date("2026-01-01T00:00:00Z");
const collections = [
  "gameState",
  "countryGameStates",
  "states",
  "elections",
  "electionVoteTallies",
  "electionCandidates",
  "electedOfficials",
  "npps",
  "characters",
  "governmentFormations",
  BG_ORDINARY_PLANS_COLLECTION,
  "bgAssemblyOfficeArchives",
  "notifications",
  "bankAccounts",
  "politicalParties",
];

describe.skipIf(!uri)(
  "Bulgarian national count and atomic chamber handover on isolated Mongo",
  () => {
    let client: MongoClient;
    let commands = 0;
    beforeAll(async () => {
      const address = new URL(uri!);
      if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
        throw new Error("Bulgarian qualification requires explicit loopback Mongo");
      client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
      client.on("commandStarted", () => commands++);
      await client.connect();
      const hello = await client.db("admin").command({ hello: 1 });
      if (!hello.setName || !hello.isWritablePrimary)
        throw new Error("Bulgarian qualification requires a writable replica set");
      vi.mocked(getMongoClient).mockResolvedValue(client);
    });
    afterAll(async () => {
      await client?.close();
    });
    async function fixture() {
      const db = client.db(`ahd_test_bg_ordinary_${new ObjectId().toHexString()}`);
      for (const name of collections) await db.createCollection(name);
      await db
        .collection("gameState")
        .insertOne({ _id: "current", preset: "1991-default", currentTurn: 40 } as never);
      await db.collection("countryGameStates").insertOne({ _id: "BG" } as never);
      await db
        .collection("governmentFormations")
        .insertOne({ _id: "BG", totalSeats: 400, majorityThreshold: 201 } as never);
      await db.collection("states").insertMany(bgRegions1991);
      const player = new ObjectId(),
        executive = new ObjectId();
      await db.collection("characters").insertOne({
        _id: player,
        countryId: "BG",
        party: "A",
        userId: new ObjectId(),
        currentOffice: null,
        careerHistory: [],
      });
      await db.collection("npps").insertOne({
        _id: executive,
        countryId: "BG",
        party: "A",
        currentOffice: { type: "president" },
        retiredAt: null,
        balance: 500,
      });
      await db.collection("electedOfficials").insertOne({
        _id: new ObjectId(),
        countryId: "BG",
        officeType: "president",
        nppId: executive,
        characterId: null,
      });
      for (const [index, region] of bgRegions1991.entries()) {
        const electionId = new ObjectId(),
          incumbent = new ObjectId();
        await db.collection("npps").insertOne({
          _id: incumbent,
          countryId: "BG",
          party: "B",
          retiredAt: null,
          balance: 100 + index,
          currentOffice: {
            type: "assemblyDeputy",
            state: region._id,
            seatsHeld: region.houseDistricts,
          },
        });
        await db.collection("electedOfficials").insertOne({
          _id: new ObjectId(),
          countryId: "BG",
          officeType: "assemblyDeputy",
          state: region._id,
          seatsHeld: region.houseDistricts,
          nppId: incumbent,
          characterId: null,
        });
        const candidates = ["A", "B"].map((party, order) => ({
          _id: new ObjectId(),
          electionId,
          countryId: "BG",
          nppId: new ObjectId(),
          characterId: new ObjectId(),
          isNPP: true,
          characterName: `List ${index} ${party}`,
          party,
          status: "active",
          enteredAt: new Date(now.getTime() + order + 1),
        }));
        await db.collection("npps").insertMany(
          candidates.map((row) => ({
            _id: row.nppId,
            countryId: "BG",
            party: row.party,
            retiredAt: null,
            isTechnocrat: false,
            currentOffice: null,
            balance: 1000 + index,
          }))
        );
        const human = {
          _id: new ObjectId(),
          electionId,
          countryId: "BG",
          characterId: player,
          isNPP: false,
          characterName: "Synthetic player",
          party: "A",
          status: "active",
          enteredAt: now,
        };
        const nominees = index === 0 ? [...candidates, human] : candidates;
        await db.collection("electionCandidates").insertMany(nominees);
        await db.collection("elections").insertOne({
          _id: electionId,
          countryId: "BG",
          electionType: "nationalAssembly",
          cycle: 1,
          electionYear: 1991,
          state: region._id,
          totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[region._id],
          status: "completed",
          createdAt: now,
          updatedAt: now,
        });
        await db.collection("electionVoteTallies").insertOne({
          _id: new ObjectId(),
          electionId,
          state: region._id,
          finalized: false,
          totalVotes: {
            [candidates[0]._id.toHexString()]: index === 0 ? 550 : 600,
            [candidates[1]._id.toHexString()]: 400,
            ...(index === 0 ? { [human._id.toHexString()]: 50 } : {}),
          },
          candidateParties: Object.fromEntries(
            nominees.map((row) => [row._id.toHexString(), row.party])
          ),
          turnSnapshots: [],
        });
      }
      await db
        .collection("bankAccounts")
        .insertOne({ _id: new ObjectId(), ownerId: player, balance: 12345 });
      vi.mocked(getDb).mockResolvedValue(db);
      return { db, player, executive };
    }
    async function snapshot(db: Db) {
      const result: Record<string, string> = {};
      for (const name of collections)
        result[name] = Buffer.from(
          BSON.serialize({
            rows: await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
          })
        ).toString("hex");
      return result;
    }
    async function setTurn(db: Db, turn: number) {
      await db
        .collection("gameState")
        .updateOne({ _id: "current" } as never, { $set: { currentTurn: turn } });
    }

    it("uses the normal dispatcher, waits for November, preserves money, and seats all 240 mandates once", async () => {
      const { db, player, executive } = await fixture();
      try {
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDeputy" })
        ).toBe(5);
        const receipt = await db
          .collection(BG_ORDINARY_PLANS_COLLECTION)
          .findOne({ _id: "BG:ordinary:1" } as never);
        expect(receipt?.plan.partySeats).toEqual({ A: 144, B: 96 });
        expect(Object.keys(receipt!.plan.districtSeats)).toHaveLength(31);
        const accounts = (await snapshot(db)).bankAccounts;
        const balances = await db
          .collection("npps")
          .find({}, { projection: { balance: 1 } })
          .sort({ _id: 1 })
          .toArray();
        await setTurn(db, 41);
        const start = commands;
        expect(await resolveGeneralElections(now)).toBe(5);
        console.info("Bulgarian normal handover Mongo commands", commands - start);
        expect(commands - start).toBeLessThanOrEqual(45);
        const officials = await db
          .collection("electedOfficials")
          .find({ officeType: "assemblyDeputy" })
          .toArray();
        expect(officials.reduce((sum, row) => sum + row.seatsHeld, 0)).toBe(240);
        expect(officials.find((row) => row.characterId?.equals(player))?.seatsHeld).toBe(1);
        expect(await db.collection("electedOfficials").findOne({ nppId: executive })).toMatchObject(
          { officeType: "president" }
        );
        expect(
          await db
            .collection("npps")
            .find({}, { projection: { balance: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(balances);
        expect((await snapshot(db)).bankAccounts).toBe(accounts);
        expect(
          await db.collection("notifications").countDocuments({ userId: { $exists: true } })
        ).toBe(1);
        expect(await db.collection("bgAssemblyOfficeArchives").countDocuments()).toBe(5);
        expect(
          await db
            .collection("electionVoteTallies")
            .countDocuments({ finalized: true, resolutionPath: "bg_ordinary_national" })
        ).toBe(5);
        expect(
          await db.collection("countryGameStates").findOne({ _id: "BG" } as never)
        ).toMatchObject({ bgOrdinaryAssemblySinceTurn: 41 });
        const beforeReplay = await snapshot(db);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(await snapshot(db)).toEqual(beforeReplay);
      } finally {
        await db.dropDatabase();
      }
    });

    it("reconciles a partly resolved legacy cycle together instead of stranding its remaining regions", async () => {
      const { db } = await fixture();
      try {
        await setTurn(db, 41);
        const old = await db.collection("elections").findOne({ countryId: "BG" });
        if (!old) throw new Error("Fixture ballot is missing");
        await db
          .collection("elections")
          .updateOne({ _id: old._id }, { $set: { status: "resolved" } });
        await db
          .collection("electionVoteTallies")
          .updateOne({ electionId: old._id }, { $set: { finalized: true } });
        await db
          .collection("electionCandidates")
          .updateMany({ electionId: old._id }, { $set: { status: "withdrawn" } });
        expect(await resolveGeneralElections(now)).toBe(5);
        expect(await db.collection("elections").countDocuments({ status: "resolved" })).toBe(5);
        const receipt = await db
          .collection(BG_ORDINARY_PLANS_COLLECTION)
          .findOne({ _id: "BG:ordinary:1" } as never);
        expect(receipt?.legacyResolvedElectionIds).toEqual([old._id.toHexString()]);
        expect(receipt?.plan.partySeats).toEqual({ A: 144, B: 96 });
        expect(await db.collection("bgAssemblyOfficeArchives").countDocuments()).toBe(5);
        const officials = await db
          .collection("electedOfficials")
          .find({ officeType: "assemblyDeputy" })
          .toArray();
        expect(officials.reduce((sum, row) => sum + row.seatsHeld, 0)).toBe(240);
        const before = await snapshot(db);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });

    it("rolls back every handover write on the final receipt failure, then tolerates concurrent resolution and replay", async () => {
      const { db } = await fixture();
      try {
        await setTurn(db, 41);
        await readBgOrdinaryElectionPlan(db, 1, now);
        const before = await snapshot(db);
        const failing = new Proxy(db, {
          get(target, key) {
            if (key !== "collection") {
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: string) => {
              const collection = target.collection(name);
              if (name !== BG_ORDINARY_PLANS_COLLECTION) return collection;
              return new Proxy(collection, {
                get(inner, property) {
                  if (property === "updateOne")
                    return async (
                      filter: object,
                      update: { $set?: { seatedAtTurn?: number } },
                      options: object
                    ) => {
                      if (update.$set?.seatedAtTurn != null)
                        throw new Error("injected final Bulgarian receipt failure");
                      return inner.updateOne(filter, update, options);
                    };
                  const value = Reflect.get(inner, property);
                  return typeof value === "function" ? value.bind(inner) : value;
                },
              });
            };
          },
        });
        vi.mocked(getDb).mockResolvedValue(failing);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(await snapshot(db)).toEqual(before);
        vi.mocked(getDb).mockResolvedValue(db);
        const results = await Promise.all([
          resolveGeneralElections(now),
          resolveGeneralElections(now),
        ]);
        expect(results.reduce((sum, result) => sum + result, 0)).toBe(5);
        expect(await db.collection("bgAssemblyOfficeArchives").countDocuments()).toBe(5);
        expect(await db.collection("notifications").countDocuments()).toBe(1);
        const settled = await snapshot(db);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(await snapshot(db)).toEqual(settled);
      } finally {
        await db.dropDatabase();
      }
    });
  }
);
