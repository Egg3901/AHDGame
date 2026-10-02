import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { huRegions1991 } from "./data/huRegions1991";
import { materializeHu1991CampaignBinding } from "./assemblyCampaignBinding1991";
import { certifyHu1991FirstCount, HU_1991_COUNTS_COLLECTION } from "./assemblyCount1991";
import { seatHu1991Assembly } from "./assemblySeating1991";

import { openHu1991Runoff, certifyHu1991Runoff } from "./assemblyRunoff1991";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { registerHu1991PlayerFiling, HU_1991_FILING_LOCKS_COLLECTION } from "./playerFiling1991";
import {
  openHu1991ByElections,
  resolveHu1991ByElection,
  HU_1991_BY_ELECTIONS_COLLECTION,
} from "./constituencyByElections1991";
import { HU_1991_CONSTITUENCIES } from "./data/electoralDistricts1991";
vi.mock("@/lib/news", () => ({ generateElectionNews: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/election/electionNotifications", () => ({
  sendBatchedElectionResults: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAuditBulk: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const now = new Date("2026-01-01T00:00:00Z");
const names = [
  "gameState",
  "states",
  "stateRegistrationPool",
  "elections",
  "electionCandidates",
  "electionVoteTallies",
  "electedOfficials",
  "npps",
  "characters",
  "governmentFormations",
  HU_1991_COUNTS_COLLECTION,
  "hu1991AssemblyOfficeArchives",
  "bankAccounts",
  "notifications",
  "campaigns",
  "politicalParties",
  HU_1991_FILING_LOCKS_COLLECTION,
  HU_1991_BY_ELECTIONS_COLLECTION,
];
type StringRecord = { _id: string; [key: string]: unknown };

describe.skipIf(!uri)(
  "Hungarian statutory count and whole-Assembly transactions on isolated Mongo",
  () => {
    let client: MongoClient;
    let commands = 0,
      commandBytes = 0,
      replyBytes = 0;
    beforeAll(async () => {
      const address = new URL(uri!);
      if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
        throw new Error("Hungarian qualification requires explicit loopback Mongo");
      client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
      client.on("commandStarted", (event) => {
        commands++;
        commandBytes += BSON.calculateObjectSize(event.command);
      });
      client.on("commandSucceeded", (event) => {
        // BSON wrapper adds five document bytes plus the type and "reply" key.
        replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
      });
      await client.connect();
      const hello = await client.db("admin").command({ hello: 1 });
      if (!hello.setName || !hello.isWritablePrimary)
        throw new Error("Hungarian qualification requires a writable replica set");
      vi.mocked(getMongoClient).mockResolvedValue(client);
    });
    afterAll(async () => {
      await client?.close();
    });
    async function fixture() {
      const db = client.db(`ahd_test_hu_1991_${new ObjectId().toHexString()}`);
      for (const name of names) await db.createCollection(name);
      await db
        .collection<StringRecord>("gameState")
        .insertOne({ _id: "current", preset: "1991-default", currentTurn: 101 });
      await db
        .collection<StringRecord>("governmentFormations")
        .insertOne({ _id: "HU", totalSeats: 386, majorityThreshold: 194 });
      await db
        .collection<StringRecord>("states")
        .insertMany(huRegions1991.map((row) => ({ ...row, votingEligiblePopulation: 10000 })));
      await db.collection("stateRegistrationPool").insertMany(
        huRegions1991.map((row) => ({
          _id: new ObjectId(),
          countryId: "HU",
          stateId: row._id,
          unregistered: 0,
        }))
      );
      const human = new ObjectId(),
        president = new ObjectId();
      await db.collection("characters").insertOne({
        _id: human,
        countryId: "HU",
        party: "A",
        userId: new ObjectId(),
        currentOffice: null,
        careerHistory: [],
      });
      await db.collection("npps").insertOne({
        _id: president,
        countryId: "HU",
        party: "A",
        currentOffice: { type: "president" },
        balance: 500,
        retiredAt: null,
      });
      await db.collection("electedOfficials").insertOne({
        _id: new ObjectId(),
        countryId: "HU",
        officeType: "president",
        characterId: null,
        nppId: president,
      });
      let primeMinister: ObjectId | undefined;
      for (const [index, region] of huRegions1991.entries()) {
        const electionId = new ObjectId(),
          incumbent = new ObjectId();
        await db.collection("npps").insertOne({
          _id: incumbent,
          countryId: "HU",
          party: "B",
          balance: 100,
          retiredAt: null,
          currentOffice: {
            type: "assemblyDelegate",
            state: region._id,
            seatsHeld: region.houseDistricts,
          },
        });
        await db.collection("electedOfficials").insertOne({
          _id: new ObjectId(),
          countryId: "HU",
          officeType: "assemblyDelegate",
          state: region._id,
          seatsHeld: region.houseDistricts,
          characterId: null,
          nppId: incumbent,
        });
        const candidates = ["A", "B"].map((party, order) => ({
          _id: new ObjectId(),
          electionId,
          countryId: "HU",
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
            countryId: "HU",
            party: row.party,
            retiredAt: null,
            isTechnocrat: false,
            balance: 1000,
            currentOffice: index === 0 && row.party === "A" ? { type: "primeMinister" } : null,
          }))
        );
        if (index === 0) {
          primeMinister = candidates[0].nppId;
          await db.collection("electedOfficials").insertOne({
            _id: new ObjectId(),
            countryId: "HU",
            officeType: "primeMinister",
            characterId: null,
            nppId: primeMinister,
          });
        }
        const player = {
          _id: new ObjectId(),
          electionId,
          countryId: "HU",
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
          countryId: "HU",
          electionType: "nationalAssembly",
          cycle: 1,
          electionYear: 1994,
          state: region._id,
          totalSeats: region.houseDistricts,
          status: "completed",
          endTurn: 100,
          endTime: now,
          createdAt: now,
          updatedAt: now,
        });
        await db.collection("electionVoteTallies").insertOne({
          _id: new ObjectId(),
          electionId,
          state: region._id,
          finalized: false,
          totalVotes: {
            [candidates[0]._id.toHexString()]: index === 0 ? 3900 : 4000,
            [candidates[1]._id.toHexString()]: 2000,
            ...(index === 0 ? { [player._id.toHexString()]: 100 } : {}),
          },
          candidateParties: Object.fromEntries(
            nominees.map((row) => [row._id.toHexString(), row.party])
          ),
          turnSnapshots: [],
        });
      }
      await db
        .collection("bankAccounts")
        .insertOne({ _id: new ObjectId(), ownerId: human, balance: 12345 });
      vi.mocked(getDb).mockResolvedValue(db);
      return { db, human, president, primeMinister: primeMinister! };
    }
    async function snapshot(db: Db) {
      const result: Record<string, string> = {};
      for (const name of names)
        result[name] = Buffer.from(
          BSON.serialize({ rows: await db.collection(name).find({}).sort({ _id: 1 }).toArray() })
        ).toString("hex");
      return result;
    }
    async function bind(db: Db) {
      return runRequiredTransaction((session) =>
        materializeHu1991CampaignBinding({ db, session, cycle: 1, now })
      );
    }
    it("freezes the electorate, counts the three tiers, preserves executives and money, and seats 386 distinct people once", async () => {
      const { db, human, president, primeMinister } = await fixture();
      try {
        expect(await bind(db)).toBe(true);
        await db
          .collection<StringRecord>("states")
          .updateMany({ countryId: "HU" }, { $set: { votingEligiblePopulation: 20000 } });
        expect(await bind(db)).toBe(false);
        const financialBefore = await snapshot(db);
        const balances = await db
          .collection("npps")
          .find({}, { projection: { balance: 1 } })
          .sort({ _id: 1 })
          .toArray();
        const start = commands,
          sentBefore = commandBytes,
          receivedBefore = replyBytes;
        const receipt = await certifyHu1991FirstCount(db, 1, 101, now);
        expect(receipt?.count.kind).toBe("counted");
        expect(
          receipt?.first.constituencies.reduce((sum, row) => sum + row.first.registeredVoters, 0)
        ).toBe(60000);
        expect(await seatHu1991Assembly(db, 1, 101, now)).toBe(true);
        process.stdout.write(
          JSON.stringify({
            fixture: "hu-1991-count-and-handover",
            commands: commands - start,
            commandBytes: commandBytes - sentBefore,
            replyBytes: replyBytes - receivedBefore,
          }) + "\n"
        );
        expect(commands - start).toBeLessThanOrEqual(50);
        const officials = await db
          .collection("electedOfficials")
          .find({ officeType: "assemblyDelegate" })
          .toArray();
        expect(officials).toHaveLength(386);
        expect(new Set(officials.map((row) => row.hungarianAssemblyMandate.personId)).size).toBe(
          386
        );
        expect(officials.filter((row) => row.characterId?.equals(human))).toHaveLength(1);
        expect(await db.collection("npps").findOne({ _id: president })).toMatchObject({
          currentOffice: { type: "president" },
        });
        expect(await db.collection("npps").findOne({ _id: primeMinister })).toMatchObject({
          currentOffice: { type: "primeMinister" },
        });
        expect(
          await db
            .collection("npps")
            .find({}, { projection: { balance: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(balances);
        expect((await snapshot(db)).bankAccounts).toBe(financialBefore.bankAccounts);
        expect(await db.collection("hu1991AssemblyOfficeArchives").countDocuments()).toBe(6);
        expect(await db.collection("notifications").countDocuments()).toBe(1);
        expect(
          await db
            .collection("electionVoteTallies")
            .countDocuments({ finalized: true, resolutionPath: "hu_statutory_mixed" })
        ).toBe(6);
        const npcMembers = officials.filter((row) => row.isNPP);
        for (const ownerId of new Set(npcMembers.map((row) => row.nppId.toHexString()))) {
          const owner = await db.collection("npps").findOne({ _id: new ObjectId(ownerId) });
          expect(owner?.seatsHeld).toBe(
            npcMembers.filter((row) => row.nppId.toHexString() === ownerId).length
          );
        }
        const before = await snapshot(db);
        expect(await seatHu1991Assembly(db, 1, 102, now)).toBe(false);
        expect(await certifyHu1991FirstCount(db, 1, 102, now)).toMatchObject({ seatedAtTurn: 101 });
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("keeps an incomplete cohort pending and never seats one region independently", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        const ballot = await db.collection("elections").findOne({ countryId: "HU" });
        await db
          .collection("elections")
          .updateOne({ _id: ballot!._id }, { $set: { status: "active" } });
        const before = await snapshot(db);
        expect(await certifyHu1991FirstCount(db, 1, 101, now)).toBeNull();
        expect(await seatHu1991Assembly(db, 1, 101, now)).toBe(false);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("rolls back every chamber write on the final receipt failure and tolerates concurrent handover and replay", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        const before = await snapshot(db);
        const failing = new Proxy(db, {
          get(target, key) {
            if (key !== "collection") {
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: string) => {
              const collection = target.collection(name);
              if (name !== HU_1991_COUNTS_COLLECTION) return collection;
              return new Proxy(collection, {
                get(inner, property) {
                  if (property === "updateOne")
                    return async (
                      filter: object,
                      update: { $set?: { seatedAtTurn?: number } },
                      options: object
                    ) => {
                      if (update.$set?.seatedAtTurn != null)
                        throw new Error("injected final Hungarian receipt failure");
                      return inner.updateOne(filter, update, options);
                    };
                  const value = Reflect.get(inner, property);
                  return typeof value === "function" ? value.bind(inner) : value;
                },
              });
            };
          },
        });
        await expect(seatHu1991Assembly(failing, 1, 101, now)).rejects.toThrow(/injected final/);
        expect(await snapshot(db)).toEqual(before);
        const results = await Promise.all([
          seatHu1991Assembly(db, 1, 101, now),
          seatHu1991Assembly(db, 1, 101, now),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(386);
        const final = await snapshot(db);
        expect(await seatHu1991Assembly(db, 1, 102, now)).toBe(false);
        expect(await snapshot(db)).toEqual(final);
      } finally {
        await db.dropDatabase();
      }
    });
    it("reopens insufficient-turnout territorial polls without replacing earlier votes or financial owners", async () => {
      const { db } = await fixture();
      try {
        const roots = await db.collection("elections").find({ countryId: "HU" }).toArray();
        for (const election of roots) {
          const candidates = await db
            .collection("electionCandidates")
            .find({ electionId: election._id })
            .toArray();
          await db.collection("campaigns").insertMany(
            candidates.map((row) => ({
              _id: new ObjectId(),
              electionId: election._id,
              candidateId: row.isNPP ? row.nppId : row.characterId,
              status: "active",
              funds: 123,
            }))
          );
          await db.collection("electionVoteTallies").updateOne(
            { electionId: election._id },
            {
              $set: {
                totalVotes: Object.fromEntries(candidates.map((row) => [row._id.toHexString(), 0])),
              },
            }
          );
        }
        await bind(db);
        const first = await certifyHu1991FirstCount(db, 1, 101, now);
        expect(first?.count.kind).toBe("pending");
        const original = BSON.serialize({ first: first!.first });
        const funds = await db
          .collection("campaigns")
          .find({}, { projection: { funds: 1 } })
          .sort({ _id: 1 })
          .toArray();
        const firstIds = await openHu1991Runoff(db, 1, 101, now);
        await db
          .collection("elections")
          .updateMany(
            { _id: { $in: firstIds.map((id) => new ObjectId(id)) } },
            { $set: { status: "completed" } }
          );
        expect(await certifyHu1991Runoff(db, 1, 103, now)).toBe(true);
        const failed = await db
          .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: first!._id });
        expect(failed?.count).toMatchObject({
          kind: "pending",
          territorialRepeats: expect.any(Array),
        });
        expect(await seatHu1991Assembly(db, 1, 103, now)).toBe(false);
        const repeated = await Promise.all([
          openHu1991Runoff(db, 1, 103, now),
          openHu1991Runoff(db, 1, 103, now),
        ]);
        expect(repeated[0]).toEqual(repeated[1]);
        expect(repeated[0]).toHaveLength(6);
        expect(repeated[0].some((id) => firstIds.includes(id))).toBe(false);
        for (const id of repeated[0]) {
          const electionId = new ObjectId(id);
          const candidates = await db
            .collection("electionCandidates")
            .find({ electionId })
            .toArray();
          await db.collection("electionVoteTallies").updateOne(
            { electionId },
            {
              $set: {
                totalVotes: Object.fromEntries(
                  candidates.map((row) => [row._id.toHexString(), row.party === "A" ? 3500 : 2000])
                ),
                candidateParties: Object.fromEntries(
                  candidates.map((row) => [row._id.toHexString(), row.party])
                ),
              },
            }
          );
          await db
            .collection("elections")
            .updateOne({ _id: electionId }, { $set: { status: "completed" } });
        }
        expect(await certifyHu1991Runoff(db, 1, 105, now)).toBe(true);
        expect(await seatHu1991Assembly(db, 1, 105, now)).toBe(true);
        const final = await db
          .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: first!._id });
        expect(BSON.serialize({ first: final!.first })).toEqual(original);
        expect(final?.runoffElectionIds).toHaveLength(12);
        expect(
          final?.second?.territorial.every(
            (row) => row.second?.ballotsCast === 0 && row.repeats?.length === 1
          )
        ).toBe(true);
        expect(
          await db
            .collection("campaigns")
            .find({}, { projection: { funds: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(funds);
        expect(await db.collection("characters").countDocuments()).toBe(1);
        expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
          18
        );
        const before = await snapshot(db);
        expect(await openHu1991Runoff(db, 1, 106, now)).toEqual([]);
        expect(await certifyHu1991Runoff(db, 1, 106, now)).toBe(false);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("opens genuine qualified second campaigns without duplicating funds and preserves the immutable first count", async () => {
      const { db, human } = await fixture();
      try {
        const roots = await db.collection("elections").find({ countryId: "HU" }).toArray();
        for (const election of roots) {
          const third = {
            _id: new ObjectId(),
            electionId: election._id,
            countryId: "HU",
            nppId: new ObjectId(),
            characterId: new ObjectId(),
            isNPP: true,
            characterName: `Synthetic ${election.state} C`,
            party: "C",
            status: "active",
            enteredAt: new Date(now.getTime() + 3),
          };
          await db.collection("npps").insertOne({
            _id: third.nppId,
            countryId: "HU",
            party: "C",
            currentOffice: null,
            isTechnocrat: false,
            retiredAt: null,
            balance: 1000,
          });
          await db.collection("electionCandidates").insertOne(third);
          const candidates = await db
            .collection("electionCandidates")
            .find({ electionId: election._id })
            .toArray();
          await db.collection("campaigns").insertMany(
            candidates.map((row) => ({
              _id: new ObjectId(),
              electionId: election._id,
              candidateId: row.isNPP ? row.nppId : row.characterId,
              status: "active",
              funds: 123,
              party: row.party,
            }))
          );
          const humanCandidate = candidates.find((row) => !row.isNPP);
          await db.collection("electionVoteTallies").updateOne(
            { electionId: election._id },
            {
              $set: {
                totalVotes: Object.fromEntries(
                  candidates.map((row) => [
                    row._id.toHexString(),
                    row.party === "A" && humanCandidate ? (row.isNPP ? 1900 : 100) : 2000,
                  ])
                ),
                candidateParties: Object.fromEntries(
                  candidates.map((row) => [row._id.toHexString(), row.party])
                ),
              },
            }
          );
        }
        await bind(db);
        const first = await certifyHu1991FirstCount(db, 1, 101, now);
        expect(first?.count.kind).toBe("pending");
        const firstProof = BSON.serialize({ first: first!.first });
        const funds = await db
          .collection("campaigns")
          .find({}, { projection: { funds: 1 } })
          .sort({ _id: 1 })
          .toArray();
        const profiles = await db.collection("npps").countDocuments();
        const opened = await Promise.all([
          openHu1991Runoff(db, 1, 101, now),
          openHu1991Runoff(db, 1, 101, now),
        ]);
        expect(opened[0]).toEqual(opened[1]);
        expect(opened[0]).toHaveLength(6);
        expect(
          await db.collection("elections").countDocuments({ "hungarianAssemblyRound.round": 2 })
        ).toBe(6);
        expect(
          await db
            .collection("campaigns")
            .find({}, { projection: { funds: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(funds);
        expect(await db.collection("npps").countDocuments()).toBe(profiles);
        expect(await db.collection("characters").countDocuments()).toBe(1);
        expect(await seatHu1991Assembly(db, 1, 101, now)).toBe(false);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(6);
        for (const id of opened[0]) {
          const electionId = new ObjectId(id);
          const candidates = await db
            .collection("electionCandidates")
            .find({ electionId })
            .toArray();
          const humanCandidate = candidates.find((row) => !row.isNPP);
          await db.collection("electionVoteTallies").updateOne(
            { electionId },
            {
              $set: {
                totalVotes: Object.fromEntries(
                  candidates.map((row) => [
                    row._id.toHexString(),
                    row.party === "A"
                      ? humanCandidate
                        ? row.isNPP
                          ? 3900
                          : 100
                        : 4000
                      : row.party === "B"
                        ? 2000
                        : 0,
                  ])
                ),
                candidateParties: Object.fromEntries(
                  candidates.map((row) => [row._id.toHexString(), row.party])
                ),
              },
            }
          );
          await db
            .collection("elections")
            .updateOne({ _id: electionId }, { $set: { status: "completed" } });
        }
        expect(await certifyHu1991Runoff(db, 1, 102, now)).toBe(false);
        const tampered = await db.collection("electionCandidates").findOne({
          "hungarianAssemblyNomination.rootCandidateId": { $exists: true },
          isNPP: true,
        });
        await db
          .collection("electionCandidates")
          .updateOne({ _id: tampered!._id }, { $set: { nppId: new ObjectId() } });
        await expect(certifyHu1991Runoff(db, 1, 103, now)).rejects.toThrow(
          /person or party changed/
        );
        await db
          .collection("electionCandidates")
          .updateOne({ _id: tampered!._id }, { $set: { nppId: tampered!.nppId } });
        expect(await certifyHu1991Runoff(db, 1, 103, now)).toBe(true);
        expect(await seatHu1991Assembly(db, 1, 103, now)).toBe(true);
        const final = await db
          .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: first!._id });
        expect(BSON.serialize({ first: final!.first })).toEqual(firstProof);
        if (final?.count.kind !== "counted")
          throw new Error("A committed Hungarian receipt must contain the certified count");
        expect(final.count.constituencySeats).toEqual({ A: 176 });
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(386);
        expect(
          await db
            .collection("electedOfficials")
            .countDocuments({ characterId: human, officeType: "assemblyDelegate" })
        ).toBe(1);
        expect(await db.collection("electionVoteTallies").countDocuments({ finalized: true })).toBe(
          12
        );
        const before = await snapshot(db);
        expect(await openHu1991Runoff(db, 1, 104, now)).toEqual([]);
        expect(await certifyHu1991Runoff(db, 1, 104, now)).toBe(false);
        expect(await seatHu1991Assembly(db, 1, 104, now)).toBe(false);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("fills a constituency vacancy atomically without changing compensation, held mandates, terms or balances", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        await seatHu1991Assembly(db, 1, 101, now);
        const parentBefore = await db
          .collection<StringRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: "HU:mixed1989:1" });
        const seat = await db
          .collection("electedOfficials")
          .findOne({ "hungarianAssemblyMandate.tier": "constituency", isNPP: true });
        await db.collection("electedOfficials").deleteOne({ _id: seat!._id });
        const held = await db.collection("electedOfficials").find().sort({ _id: 1 }).toArray();
        const finances = await db
          .collection("npps")
          .find({}, { projection: { balance: 1 } })
          .sort({ _id: 1 })
          .toArray();
        const opened = await Promise.all([
          openHu1991ByElections(db, 102, now),
          openHu1991ByElections(db, 102, now),
        ]);
        expect(opened[0]).toEqual(opened[1]);
        expect(opened[0]).toHaveLength(1);
        const poll = await db.collection("elections").findOne({ _id: new ObjectId(opened[0][0]) });
        expect(poll!.hungarianAssemblyRound.byElection.districtIds).toEqual([seat!.constituencyId]);
        const candidates = await db
          .collection("electionCandidates")
          .find({ electionId: poll!._id })
          .toArray();
        await db.collection("electionVoteTallies").updateOne(
          { electionId: poll!._id },
          {
            $set: {
              totalVotes: Object.fromEntries(
                candidates.map((row) => [row._id.toHexString(), row.party === "A" ? 6000 : 2000])
              ),
              candidateParties: Object.fromEntries(
                candidates.map((row) => [row._id.toHexString(), row.party])
              ),
            },
          }
        );
        await db
          .collection("elections")
          .updateOne({ _id: poll!._id }, { $set: { status: "completed" } });
        expect(
          await resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 105, now)
        ).toBe(0);
        const before = await snapshot(db);
        const failing = new Proxy(db, {
          get(target, key) {
            if (key !== "collection") {
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: string) => {
              const collection = target.collection(name);
              if (name !== HU_1991_BY_ELECTIONS_COLLECTION) return collection;
              return new Proxy(collection, {
                get(inner, property) {
                  if (property === "updateOne")
                    return async () => {
                      throw new Error("injected by-election receipt failure");
                    };
                  const value = Reflect.get(inner, property);
                  return typeof value === "function" ? value.bind(inner) : value;
                },
              });
            };
          },
        });
        await expect(
          resolveHu1991ByElection(failing, poll!.hungarianAssemblyRound.receiptId, 106, now)
        ).rejects.toThrow(/injected/);
        expect(await snapshot(db)).toEqual(before);
        const results = await Promise.all([
          resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 106, now),
          resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 106, now),
        ]);
        expect(results.sort()).toEqual([0, 1]);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(386);
        const replacement = await db.collection("electedOfficials").findOne({
          constituencyId: seat!.constituencyId,
          "hungarianAssemblyMandate.tier": "constituency",
        });
        expect(replacement!.termEnds).toEqual(seat!.termEnds);
        expect(
          await db
            .collection("electedOfficials")
            .find({ _id: { $in: held.map((row) => row._id) } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(held);
        const parentAfter = await db
          .collection<StringRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: "HU:mixed1989:1" });
        expect(parentAfter!.count).toEqual(parentBefore!.count);
        expect(parentAfter!.settled).toEqual(parentBefore!.settled);
        expect(
          await db
            .collection("npps")
            .find({}, { projection: { balance: 1 } })
            .sort({ _id: 1 })
            .toArray()
        ).toEqual(finances);
        const completed = await snapshot(db);
        expect(
          await resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 107, now)
        ).toBe(0);
        expect(await openHu1991ByElections(db, 108, now)).toEqual([]);
        expect(await snapshot(db)).toEqual(completed);
      } finally {
        await db.dropDatabase();
      }
    });
    it("keeps failed by-election seats vacant, retries after a bounded cooldown and refuses to extend the chamber term", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        await seatHu1991Assembly(db, 1, 101, now);
        const seat = await db
          .collection("electedOfficials")
          .findOne({ "hungarianAssemblyMandate.tier": "constituency", isNPP: true });
        await db.collection("electedOfficials").deleteOne({ _id: seat!._id });
        const ids = await openHu1991ByElections(db, 102, now);
        const poll = await db.collection("elections").findOne({ _id: new ObjectId(ids[0]) });
        await db
          .collection("elections")
          .updateOne({ _id: poll!._id }, { $set: { status: "completed" } });
        expect(
          await resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 106, now)
        ).toBe(0);
        const pending = await db
          .collection(HU_1991_BY_ELECTIONS_COLLECTION)
          .findOne({ _id: poll!.hungarianAssemblyRound.receiptId });
        expect(pending!.round).toBe(2);
        await db
          .collection("elections")
          .updateMany(
            { _id: { $in: pending!.activeElectionIds.map((id: string) => new ObjectId(id)) } },
            { $set: { status: "completed" } }
          );
        expect(
          await resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 108, now)
        ).toBe(2);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(385);
        expect(await openHu1991ByElections(db, 109, now)).toEqual([]);
        const again = await openHu1991ByElections(db, 110, now);
        expect(again).toHaveLength(1);
        expect(again[0]).not.toBe(ids[0]);
        expect(await openHu1991ByElections(db, 293, now)).toEqual([]);
        expect(
          await db.collection("elections").findOne({ _id: new ObjectId(again[0]) })
        ).toMatchObject({ status: "cancelled" });
        expect(await openHu1991ByElections(db, 294, now)).toEqual([]);
      } finally {
        await db.dropDatabase();
      }
    });
    it("certifies genuine by-election second rounds and records only awarded constituency seats", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        await seatHu1991Assembly(db, 1, 101, now);
        const seat = await db
          .collection("electedOfficials")
          .findOne({ "hungarianAssemblyMandate.tier": "constituency", isNPP: true });
        await db
          .collection("electedOfficials")
          .updateOne({ _id: seat!._id }, { $set: { characterId: null, nppId: null } });
        // The next ordinary campaign already runs all term, as it does in
        // the real scheduler. It must not suppress this constituency vacancy.
        const regularId = new ObjectId();
        await db.collection("elections").insertOne({
          _id: regularId,
          countryId: "HU",
          electionType: "nationalAssembly",
          cycle: 2,
          status: "active",
          endTurn: 293,
        });
        expect(await openHu1991ByElections(db, 288, now)).toEqual([]);
        const openingStart = commands;
        const ids = await openHu1991ByElections(db, 102, now);
        const openingCommands = commands - openingStart;
        const firstId = new ObjectId(ids[0]);
        const firstPoll = await db.collection("elections").findOne({ _id: firstId });
        const firstCandidates = await db
          .collection("electionCandidates")
          .find({ electionId: firstId })
          .toArray();
        await db.collection("electionVoteTallies").updateOne(
          { electionId: firstId },
          {
            $set: {
              totalVotes: Object.fromEntries(
                firstCandidates.map((row) => [row._id.toHexString(), 3000])
              ),
              candidateParties: Object.fromEntries(
                firstCandidates.map((row) => [row._id.toHexString(), row.party])
              ),
            },
          }
        );
        await db
          .collection("elections")
          .updateOne({ _id: firstId }, { $set: { status: "completed" } });
        expect(
          await resolveHu1991ByElection(db, firstPoll!.hungarianAssemblyRound.receiptId, 106, now)
        ).toBe(0);
        const job = await db
          .collection<import("./constituencyByElections1991").Hu1991ByElectionRecord>(
            HU_1991_BY_ELECTIONS_COLLECTION
          )
          .findOne({ _id: firstPoll!.hungarianAssemblyRound.receiptId });
        const secondId = new ObjectId(job!.activeElectionIds[0]);
        const secondCandidates = await db
          .collection("electionCandidates")
          .find({ electionId: secondId })
          .toArray();
        await db.collection("electionVoteTallies").updateOne(
          { electionId: secondId },
          {
            $set: {
              totalVotes: Object.fromEntries(
                secondCandidates.map((row) => [
                  row._id.toHexString(),
                  row.party === "B" ? 4000 : 2000,
                ])
              ),
              candidateParties: Object.fromEntries(
                secondCandidates.map((row) => [row._id.toHexString(), row.party])
              ),
            },
          }
        );
        await db
          .collection("elections")
          .updateOne({ _id: secondId }, { $set: { status: "completed" } });
        const seatingStart = commands;
        expect(await resolveHu1991ByElection(db, job!._id, 108, now)).toBe(2);
        const seatingCommands = commands - seatingStart;
        process.stdout.write(
          JSON.stringify({ fixture: "hu-1991-by-election", openingCommands, seatingCommands }) +
            "\n"
        );
        expect(openingCommands).toBeLessThanOrEqual(25);
        expect(seatingCommands).toBeLessThanOrEqual(25);
        const winner = await db.collection("electedOfficials").findOne({
          constituencyId: seat!.constituencyId,
          "hungarianAssemblyMandate.tier": "constituency",
        });
        expect(winner!.party).toBe("B");
        expect(
          await db.collection("electedOfficials").countDocuments({
            constituencyId: seat!.constituencyId,
            "hungarianAssemblyMandate.tier": "constituency",
          })
        ).toBe(1);
        expect(
          await db
            .collection("hu1991AssemblyOfficeArchives")
            .countDocuments({ "official._id": seat!._id })
        ).toBe(1);
        expect(winner!.termEnds).toEqual(seat!.termEnds);
        const secondTally = await db
          .collection("electionVoteTallies")
          .findOne({ electionId: secondId });
        expect(secondTally!.resolvedTotalSeats).toBe(1);
        expect(
          Object.values(secondTally!.seatsEstimate).reduce(
            (sum: number, value) => sum + Number(value),
            0
          )
        ).toBe(1);
        expect(secondTally!.resolvedSeatHolders).toHaveLength(1);
        expect(job!.ballots![0].first.candidates[0].votes).toBeGreaterThan(0);
      } finally {
        await db.dropDatabase();
      }
    });
    it("cancels old by-election custody after a newer Assembly takes office", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        await seatHu1991Assembly(db, 1, 101, now);
        const seat = await db
          .collection("electedOfficials")
          .findOne({ "hungarianAssemblyMandate.tier": "constituency", isNPP: true });
        await db.collection("electedOfficials").deleteOne({ _id: seat!._id });
        const ids = await openHu1991ByElections(db, 102, now);
        const poll = await db.collection("elections").findOne({ _id: new ObjectId(ids[0]) });
        const original = await db
          .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: "HU:mixed1989:1" });
        await db
          .collection<import("./assemblyCount1991").Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .insertOne({ ...original!, _id: "HU:mixed1989:2", cycle: 2, seatedAtTurn: 103 });
        const held = await db.collection("electedOfficials").find().sort({ _id: 1 }).toArray();
        expect(
          await resolveHu1991ByElection(db, poll!.hungarianAssemblyRound.receiptId, 104, now)
        ).toBe(1);
        expect(await db.collection("elections").findOne({ _id: poll!._id })).toMatchObject({
          status: "cancelled",
        });
        expect(await db.collection("electedOfficials").find().sort({ _id: 1 }).toArray()).toEqual(
          held
        );
      } finally {
        await db.dropDatabase();
      }
    });
    it("files a new independent player in a vacant seat and delivers one win notice through normal turn resolution", async () => {
      const { db } = await fixture();
      try {
        await bind(db);
        await certifyHu1991FirstCount(db, 1, 101, now);
        await seatHu1991Assembly(db, 1, 101, now);
        const seat = await db
          .collection("electedOfficials")
          .findOne({ "hungarianAssemblyMandate.tier": "constituency", isNPP: true });
        await db.collection("electedOfficials").deleteOne({ _id: seat!._id });
        const ids = await openHu1991ByElections(db, 102, now);
        const electionId = new ObjectId(ids[0]);
        const poll = await db.collection("elections").findOne({ _id: electionId });
        const player = new ObjectId(),
          userId = new ObjectId();
        await db.collection("characters").insertOne({
          _id: player,
          userId,
          countryId: "HU",
          homeState: poll!.state,
          party: "independent",
          currentOffice: null,
          careerHistory: [],
          balance: 5000,
        });
        const filed = await registerHu1991PlayerFiling({
          db,
          electionId,
          requestedDistrictId: seat!.constituencyId,
          candidate: {
            electionId,
            characterId: player,
            characterName: "Synthetic by-election player",
            countryId: "HU",
            party: "independent",
            status: "active",
            isNPP: false,
            enteredAt: now,
          },
          turn: 103,
          now,
        });
        expect(filed.allowed).toBe(true);
        const candidates = await db.collection("electionCandidates").find({ electionId }).toArray();
        await db.collection("electionVoteTallies").updateOne(
          { electionId },
          {
            $set: {
              totalVotes: Object.fromEntries(
                candidates.map((row) => [row._id.toHexString(), row.isNPP ? 200 : 9000])
              ),
              candidateParties: Object.fromEntries(
                candidates.map((row) => [row._id.toHexString(), row.party])
              ),
            },
          }
        );
        await db
          .collection("elections")
          .updateOne({ _id: electionId }, { $set: { status: "completed" } });
        await db
          .collection<StringRecord>("gameState")
          .updateOne({ _id: "current" }, { $set: { currentTurn: 106 } });
        expect(await resolveGeneralElections(now)).toBe(1);
        expect(
          await db
            .collection("electedOfficials")
            .countDocuments({ characterId: player, officeType: "assemblyDelegate" })
        ).toBe(1);
        expect(
          await db.collection("notifications").countDocuments({ userId, type: "general_win" })
        ).toBe(1);
        expect(await db.collection("characters").findOne({ _id: player })).toMatchObject({
          balance: 5000,
          currentOffice: { type: "assemblyDelegate", seatsHeld: 1 },
          careerHistory: [
            { type: "elected", officeLabel: "National Assembly Deputy", partyCountryId: "HU" },
          ],
        });
        const before = await snapshot(db);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(
          await db.collection("notifications").countDocuments({ userId, type: "general_win" })
        ).toBe(1);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("leaves a scoped partial cohort untouched and accepts an explicitly selected whole cohort", async () => {
      const { db } = await fixture();
      try {
        const roots = await db.collection("elections").find({ countryId: "HU" }).toArray();
        const before = await snapshot(db);
        expect(await resolveGeneralElections(now, [roots[0]._id])).toBe(0);
        expect(await snapshot(db)).toEqual(before);
        expect(
          await resolveGeneralElections(
            now,
            roots.map((row) => row._id)
          )
        ).toBe(6);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(386);
      } finally {
        await db.dropDatabase();
      }
    });
    it("uses the normal turn dispatcher and holds every regional result until one national handover", async () => {
      const { db, human } = await fixture();
      try {
        const root = await db.collection("elections").findOne({ countryId: "HU" });
        await db
          .collection("elections")
          .updateOne({ _id: root!._id }, { $set: { status: "active" } });
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(6);
        await db
          .collection("elections")
          .updateOne({ _id: root!._id }, { $set: { status: "completed" } });
        expect(await resolveGeneralElections(now)).toBe(6);
        expect(
          await db.collection("electedOfficials").countDocuments({ officeType: "assemblyDelegate" })
        ).toBe(386);
        expect(
          await db
            .collection("electedOfficials")
            .countDocuments({ characterId: human, officeType: "assemblyDelegate" })
        ).toBe(1);
        expect(await db.collection("elections").countDocuments({ status: "resolved" })).toBe(6);
        const before = await snapshot(db);
        expect(await resolveGeneralElections(now)).toBe(0);
        expect(await snapshot(db)).toEqual(before);
      } finally {
        await db.dropDatabase();
      }
    });
    it("reserves a player's party district atomically and reuses the same person and cast votes after withdrawal", async () => {
      const { db, human } = await fixture();
      try {
        await bind(db);
        const original = await db
          .collection("electionCandidates")
          .findOne({ characterId: human, isNPP: false });
        const electionId = original!.electionId;
        const election = await db.collection("elections").findOne({ _id: electionId });
        await db
          .collection("characters")
          .updateOne({ _id: human }, { $set: { homeState: election!.state, party: "1" } });
        await db.collection("electionCandidates").deleteOne({ _id: original!._id });
        await db.collection("politicalParties").insertOne({
          _id: new ObjectId(),
          countryId: "HU",
          sequentialId: 1,
          regimeStatus: "legal",
        });
        await db
          .collection("elections")
          .updateOne({ _id: electionId }, { $set: { status: "active", primaryEndTurn: 110 } });
        const requestedDistrictId = HU_1991_CONSTITUENCIES.find(
          (row) => row.regionId === election!.state
        )!.id;
        const candidate = {
          electionId,
          countryId: "HU" as const,
          characterId: human,
          characterName: "Synthetic player",
          party: "1",
          status: "active" as const,
          enteredAt: now,
        };
        const results = await Promise.all([
          registerHu1991PlayerFiling({
            db,
            electionId,
            candidate,
            requestedDistrictId,
            turn: 101,
            now,
          }),
          registerHu1991PlayerFiling({
            db,
            electionId,
            candidate,
            requestedDistrictId,
            turn: 101,
            now,
          }),
        ]);
        expect(results.filter((row) => row.allowed)).toHaveLength(1);
        const successful = results.find((row) => row.allowed)!;
        if (!successful.allowed) throw new Error("Exactly one concurrent filing must win");
        expect(
          await db
            .collection("electionCandidates")
            .countDocuments({ characterId: human, electionId })
        ).toBe(1);
        expect(await db.collection(HU_1991_FILING_LOCKS_COLLECTION).countDocuments()).toBe(2);
        await db
          .collection("electionCandidates")
          .updateOne(
            { _id: successful.insertedId },
            { $set: { status: "withdrawn", lastRallyTurn: 100, support: 63 } }
          );
        await db
          .collection("electionVoteTallies")
          .updateOne(
            { electionId },
            { $set: { ["totalVotes." + successful.insertedId.toHexString()]: 77 } }
          );
        const reentered = await registerHu1991PlayerFiling({
          db,
          electionId,
          candidate,
          requestedDistrictId,
          turn: 102,
          now,
        });
        expect(reentered).toEqual({ allowed: true, insertedId: successful.insertedId });
        expect(
          await db.collection("electionCandidates").findOne({ _id: successful.insertedId })
        ).toMatchObject({
          status: "active",
          lastRallyTurn: 100,
          support: 63,
          hungarianAssemblyNomination: { constituencyId: requestedDistrictId },
        });
        expect(
          (await db.collection("electionVoteTallies").findOne({ electionId }))!.totalVotes[
            successful.insertedId.toHexString()
          ]
        ).toBe(77);
        expect(
          await registerHu1991PlayerFiling({
            db,
            electionId,
            candidate,
            requestedDistrictId,
            turn: 110,
            now,
          })
        ).toMatchObject({ allowed: false, reason: "filing-closed" });
        expect(await db.collection("characters").countDocuments()).toBe(1);
      } finally {
        await db.dropDatabase();
      }
    });
  }
);
