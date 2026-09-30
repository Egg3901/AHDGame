/**
 * Real sandbox-Mongo qualification for the 1991 Bulgarian Assembly change.
 * Opt in with AHD_BG_TRANSITION_REAL_MONGO=1; CI has no Mongo service.
 */
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { expect, it, vi } from "vitest";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "@/lib/countries/bg/rules/assemblyTransition";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));

const runRealMongo = process.env.AHD_BG_TRANSITION_REAL_MONGO === "1";
const sandboxUri = "mongodb://127.0.0.1:27018";
const now = new Date("2026-09-30T00:00:00.000Z");

function totalSeats(docs: ReadonlyArray<{ seatsHeld?: number }>): number {
  return docs.reduce((sum, doc) => sum + (doc.seatsHeld ?? 0), 0);
}

function failAfterTwoRegionWrites(db: Db): Db {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "collection") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string) => {
        const collection = target.collection(name);
        if (name !== "states") return collection;
        return new Proxy(collection, {
          get(inner, method) {
            if (method === "bulkWrite") {
              return async (operations: Parameters<typeof inner.bulkWrite>[0]) => {
                await inner.bulkWrite(operations.slice(0, 2));
                throw new Error("injected crash after two persisted region writes");
              };
            }
            const value = Reflect.get(inner, method);
            return typeof value === "function" ? value.bind(inner) : value;
          },
        });
      };
    },
  });
}

it.skipIf(!runRealMongo)(
  "persists 400-to-240 Bulgarian officials, formation, and retry-safe region replacement",
  async () => {
    const dbName = `ahd_sim_issue2488_bg_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const client = await new MongoClient(sandboxUri).connect();
    const db = client.db(dbName);
    const previousUri = process.env.MONGODB_URI;
    const previousDb = process.env.MONGODB_DB;
    process.env.MONGODB_URI = `${sandboxUri}/${dbName}`;
    process.env.MONGODB_DB = dbName;

    try {
      const [resolution, transition, chamber, eligibility] = await Promise.all([
        import("@/lib/turn/election/generalResolution"),
        import("@/lib/turn/bgAssemblyTransition"),
        import("@/lib/turn/lowerChamberSeats"),
        import("@/lib/turn/election/bgOrdinaryEligibility"),
      ]);
      await db.collection("gameState").insertOne({ _id: "current", preset: "1991-default" });
      await db.collection("countryGameStates").insertOne({ _id: "BG" });
      await db
        .collection("countryState")
        .insertOne({ _id: "BG", governmentType: "parliamentaryRepublic" });
      await db.collection("states").insertMany(bgRegions1991 as Document[]);
      await db.collection("governmentFormations").insertOne({
        _id: "BG",
        totalSeats: 400,
        majorityThreshold: 201,
      });

      const incumbentNpps: ObjectId[] = [];
      for (const region of bgRegions1991) {
        const incumbentId = new ObjectId();
        incumbentNpps.push(incumbentId);
        await db.collection("npps").insertOne({
          _id: incumbentId,
          party: "A",
          retiredAt: null,
          currentOffice: {
            type: "assemblyDeputy",
            state: region._id,
            seatsHeld: region.houseDistricts,
          },
        });
        await db.collection("electedOfficials").insertOne({
          _id: new ObjectId(),
          countryId: "BG",
          state: region._id,
          officeType: "assemblyDeputy",
          nppId: incumbentId,
          isNPP: true,
          party: "A",
          seatsHeld: region.houseDistricts,
          electedAt: now,
        });
        const electionId = new ObjectId();
        const candidates = ["A", "B"].map((party, index) => ({
          _id: new ObjectId(),
          electionId,
          nppId: new ObjectId(),
          isNPP: true,
          characterName: `${region._id} ${party} candidate`,
          party,
          enteredAt: new Date(now.getTime() + index),
          status: "active",
        }));
        await db.collection("npps").insertMany(
          candidates.map((candidate) => ({
            _id: candidate.nppId,
            party: candidate.party,
            retiredAt: null,
            currentOffice: null,
          }))
        );
        await db.collection("electionCandidates").insertMany(candidates);
        await db.collection("elections").insertOne({
          _id: electionId,
          countryId: "BG",
          electionType: "nationalAssembly",
          state: region._id,
          cycle: 1,
          electionYear: 1991,
          totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[region._id],
          status: "completed",
          createdAt: now,
          updatedAt: now,
        });
        await db.collection("electionVoteTallies").insertOne({
          _id: new ObjectId(),
          electionId,
          state: region._id,
          totalVotes: {
            [candidates[0]._id.toString()]: 100,
            [candidates[1]._id.toString()]: 80,
          },
          candidateNames: Object.fromEntries(
            candidates.map((candidate) => [candidate._id.toString(), candidate.characterName])
          ),
          candidateParties: Object.fromEntries(
            candidates.map((candidate) => [candidate._id.toString(), candidate.party])
          ),
          turnSnapshots: [],
          finalized: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      const initialRegions = await db
        .collection<{ houseDistricts: number }>("states")
        .find({ countryId: "BG" })
        .toArray();
      expect(
        totalSeats(initialRegions.map((region) => ({ seatsHeld: region.houseDistricts })))
      ).toBe(400);
      expect(
        totalSeats(await db.collection("electedOfficials").find({ countryId: "BG" }).toArray())
      ).toBe(400);
      expect(await chamber.getLiveLowerChamberSeats(db, "BG")).toBe(400);

      const eligible = await eligibility.readBgOrdinaryEligibleParties(db);
      expect([...eligible!].sort()).toEqual(["A", "B"]);
      for (const row of await db.collection("elections").find({ countryId: "BG" }).toArray()) {
        const tally = await db.collection("electionVoteTallies").findOne({ electionId: row._id });
        const result = await resolution.resolveOneGeneralElection(
          db,
          row as unknown as Election,
          tally as unknown as ElectionVoteTally,
          40,
          now,
          eligible
        );
        expect(result.resolved).toBe(true);
      }
      expect(
        await db.collection("elections").countDocuments({ countryId: "BG", status: "resolved" })
      ).toBe(5);
      const officials = await db.collection("electedOfficials").find({ countryId: "BG" }).toArray();
      expect(totalSeats(officials)).toBe(240);
      expect(officials.every((official) => official.nppId instanceof ObjectId)).toBe(true);
      expect(
        await db.collection("electedOfficials").countDocuments({ nppId: { $in: incumbentNpps } })
      ).toBe(0);
      const retiredIncumbents = await db
        .collection("npps")
        .find({ _id: { $in: incumbentNpps } })
        .toArray();
      expect(retiredIncumbents).toHaveLength(5);
      expect(retiredIncumbents.every((incumbent) => incumbent.currentOffice == null)).toBe(true);
      const winnerNpps = await db
        .collection("npps")
        .find({ _id: { $in: officials.map((official) => official.nppId) } })
        .toArray();
      expect(winnerNpps).toHaveLength(officials.length);
      for (const official of officials) {
        const winner = winnerNpps.find((npp) => npp._id.equals(official.nppId));
        expect(winner?.currentOffice).toMatchObject({
          type: "assemblyDeputy",
          state: official.state,
          seatsHeld: official.seatsHeld,
        });
      }

      const state = { preset: "1991-default" } as const;
      expect(await transition.processBgAssemblyTransition(db, state, 40, now)).toBe(false);
      expect(await transition.processBgAssemblyTransition(db, state, 41, now)).toBe(true);
      // Replay an interrupted transition from the same 400-seat opening.
      await db
        .collection("countryGameStates")
        .updateOne({ _id: "BG" }, { $unset: { bgOrdinaryAssemblySinceTurn: "" } });
      await db
        .collection("governmentFormations")
        .updateOne({ _id: "BG" }, { $set: { totalSeats: 400, majorityThreshold: 201 } });
      await db.collection("states").bulkWrite(
        bgRegions1991.map((region) => ({
          updateOne: {
            filter: { _id: region._id },
            update: { $set: { houseDistricts: region.houseDistricts } },
          },
        }))
      );
      const foundingRegionSeats = await db
        .collection("states")
        .find({ countryId: "BG" }, { projection: { _id: 1, houseDistricts: 1 } })
        .toArray();
      const foundingFormation = await db.collection("governmentFormations").findOne({ _id: "BG" });
      for (const preset of ["1953-default", "1979-default", "2027-default"]) {
        expect(await transition.processBgAssemblyTransition(db, { preset }, 41, now)).toBe(false);
      }
      expect(
        await db
          .collection("states")
          .find({ countryId: "BG" }, { projection: { _id: 1, houseDistricts: 1 } })
          .toArray()
      ).toEqual(foundingRegionSeats);
      expect(await db.collection("governmentFormations").findOne({ _id: "BG" })).toEqual(
        foundingFormation
      );
      expect(
        (await db.collection("countryGameStates").findOne({ _id: "BG" }))
          ?.bgOrdinaryAssemblySinceTurn
      ).toBeUndefined();
      await expect(
        transition.processBgAssemblyTransition(failAfterTwoRegionWrites(db), state, 41, now)
      ).rejects.toThrow("injected crash");
      expect(
        (await db.collection("countryGameStates").findOne({ _id: "BG" }))
          ?.bgOrdinaryAssemblySinceTurn
      ).toBeUndefined();
      expect((await db.collection("governmentFormations").findOne({ _id: "BG" }))?.totalSeats).toBe(
        400
      );
      expect(await transition.processBgAssemblyTransition(db, state, 41, now)).toBe(true);
      expect(await transition.processBgAssemblyTransition(db, state, 42, now)).toBe(false);
      const finalRegions = await db
        .collection<{ _id: string; houseDistricts: number }>("states")
        .find({ countryId: "BG" })
        .toArray();
      expect(
        Object.fromEntries(finalRegions.map((region) => [region._id, region.houseDistricts]))
      ).toEqual(BG_ORDINARY_ASSEMBLY_SEATS);
      expect(
        (await db.collection("governmentFormations").findOne({ _id: "BG" }))?.majorityThreshold
      ).toBe(121);
      expect(
        (await db.collection("countryGameStates").findOne({ _id: "BG" }))
          ?.bgOrdinaryAssemblySinceTurn
      ).toBe(41);
      expect(await chamber.getLiveLowerChamberSeats(db, "BG")).toBe(240);
      expect(
        totalSeats(await db.collection("electedOfficials").find({ countryId: "BG" }).toArray())
      ).toBe(240);
    } finally {
      await db.dropDatabase();
      await client.close();
      if (previousUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previousUri;
      if (previousDb === undefined) delete process.env.MONGODB_DB;
      else process.env.MONGODB_DB = previousDb;
      const pooled = globalThis._mongoClientPromise;
      if (pooled) await (await pooled).close();
      globalThis._mongoClientPromise = undefined;
    }
  },
  120_000
);
