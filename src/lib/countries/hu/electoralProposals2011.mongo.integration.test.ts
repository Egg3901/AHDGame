import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import {
  HU_2011_PROPOSALS_COLLECTION,
  openHu2011ElectoralProposal,
  processHu2011ElectoralMandate,
  type Hu2011ElectoralProposal,
} from "./electoralProposals2011";
import {
  certifyHu2011Count,
  HU_2011_COUNTS_COLLECTION,
  type Hu2011AssemblyRecord,
} from "./assemblyCount2011";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { seatHu2011Assembly } from "./assemblySeating2011";
import {
  openHuModernByElections,
  HU_2011_BY_ELECTIONS_COLLECTION,
} from "./constituencyByElections2011";
import { huRegions1991 } from "./data/huRegions1991";
import {
  loadHu1991ListVacancies,
  designateHu1991ListDeputy,
  advanceHu1991ListVacancy,
  HU_1991_LIST_REPLACEMENTS_COLLECTION,
} from "./listVacancies1991";
import { processHu2011ElectoralNpcProposal } from "./electoralNpcProposals2011";
import { bindHu2011Campaigns } from "./assemblyCampaignBinding2011";
import { HU_1991_TERRITORIAL_DISTRICTS } from "./data/electoralDistricts1991";

vi.mock("@/lib/news", () => ({ generateElectionNews: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/election/electionNotifications", () => ({
  sendBatchedElectionResults: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAuditBulk: vi.fn(), recordAudit: vi.fn() }));
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

const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z");
const GAME = { preset: "1991-default" };
type StringRecord = { _id: string; [key: string]: unknown };

describe.skipIf(!uri)("Hungarian 2011 amendment on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    commandBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Electoral qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (event) => {
      commands++;
      commandBytes += BSON.calculateObjectSize(event.command);
    });
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
    });
    await client.connect();
    vi.mocked(getMongoClient).mockResolvedValue(client);
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Electoral qualification requires writable replica set");
  });
  afterAll(async () => {
    await client?.close();
  });

  async function fixture(forSeats = 130, againstSeats = 64) {
    const db = client.db(`ahd_test_hu_2011_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "governmentFormations",
      "electedOfficials",
      "bills",
      HU_2011_PROPOSALS_COLLECTION,
      "elections",
      "electionVoteTallies",
      "hu1991AssemblyCounts",
      "npps",
    ])
      await db.createCollection(name);
    await db
      .collection<StringRecord>("gameState")
      .insertOne({ _id: "current", preset: "1991-default", currentTurn: 1005 });
    await db
      .collection<StringRecord>("countryState")
      .insertOne({ ...seedCountryStateFromConfig("HU", NOW, "1991-default") });
    await db.collection<StringRecord>("countryGameStates").insertOne({ _id: "HU" });
    await db
      .collection<StringRecord>("governmentFormations")
      .insertOne({ _id: "HU", status: "formed" });
    const yes = new ObjectId(),
      no = new ObjectId(),
      absent = new ObjectId();
    await db.collection("electedOfficials").insertMany(
      Array.from({ length: 386 }, (_, i) => ({
        countryId: "HU",
        officeType: "assemblyDelegate",
        nppId: i < forSeats ? yes : i < forSeats + againstSeats ? no : absent,
        seatsHeld: 1,
        party: i < forSeats ? "1" : "2",
      }))
    );
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 1005 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    return { db, yes, no };
  }
  async function vote(db: Db, yes: ObjectId, no: ObjectId) {
    const proposal = await openHu2011ElectoralProposal({
      db,
      game: GAME,
      turn: 1005,
      now: NOW,
      sponsor: null,
    });
    await processOnePartyBillLifecycleForCountry("HU", NOW);
    expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe("active");
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: {
          votes: { [`npp_${yes}`]: "for", [`npp_${no}`]: "against" },
          votingEndsOnTurn: 1006,
        },
      }
    );
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: 1006 } as Awaited<
      ReturnType<typeof getGameState>
    >);
    await processOnePartyBillLifecycleForCountry("HU", NOW);
    return proposal;
  }
  async function primary(db: Db, cycle: number, withVotes = false, primaryEndTurn = 1100) {
    const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
    const rows = regions.map((state) => ({
      _id: new ObjectId(),
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle,
      state,
      status: "active",
      primaryEndTurn,
      hungarianAssemblyRound: {
        ruleVersion: "mixed-1989-v1",
        round: 1,
        registeredVoters: 100,
        receiptId: `HU:mixed1989:${cycle}`,
      },
    }));
    await db.collection("elections").insertMany(rows);
    await db.collection("electionVoteTallies").insertMany(
      rows.map((row) => ({
        electionId: row._id,
        totalVotes: withVotes ? { old: 1 } : {},
        finalized: false,
      }))
    );
    return rows;
  }

  it("authorizes from an actual quorate bill without resizing the sitting Assembly", async () => {
    const { db, yes, no } = await fixture();
    try {
      await db
        .collection<StringRecord>("states")
        .insertMany(huRegions1991.map((row) => ({ ...row })));
      await primary(db, 6);
      await primary(db, 7, true);
      const proposal = await vote(db, yes, no);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "signed"
      );
      commands = commandBytes = replyBytes = 0;
      expect(await processHu2011ElectoralMandate(db, GAME, 1006, NOW)).toBe(true);
      console.log({ fixture: "hu-2011-authorization", commands, commandBytes, replyBytes });
      expect(await processHu2011ElectoralMandate(db, GAME, 1007, NOW)).toBe(false);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralSystem2011SinceTurn
      ).toBe(1006);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
      expect(await bindHu2011Campaigns(db, GAME as never, 1008, NOW)).toBe(false);
      commands = commandBytes = replyBytes = 0;
      expect(await bindHu2011Campaigns(db, GAME as never, 1009, NOW)).toBe(true);
      console.log({ fixture: "hu-2011-primary-binding", commands, commandBytes, replyBytes });
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 6, "hungarianModernAssembly.ruleVersion": "mixed-2011-v1" })
      ).toBe(6);
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 6, hungarianAssemblyRound: { $exists: true } })
      ).toBe(0);
      expect(
        await db
          .collection("elections")
          .countDocuments({ cycle: 7, hungarianAssemblyRound: { $exists: true } })
      ).toBe(6);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each([
    [129, 65],
    [193, 0],
  ])("preserves old law after rejected %i/%i votes", async (forSeats, againstSeats) => {
    const { db, yes, no } = await fixture(forSeats, againstSeats);
    try {
      const proposal = await vote(db, yes, no);
      expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
        "failed"
      );
      expect(await processHu2011ElectoralMandate(db, GAME, 1006, NOW)).toBe(false);
      expect(
        (await db.collection<StringRecord>("countryGameStates").findOne({ _id: "HU" }))
          ?.huElectoralSystem2011SinceTurn
      ).toBeUndefined();
    } finally {
      await db.dropDatabase();
    }
  });
  it("counts and seats all199 modern mandates together while preserving players and financial owners", async () => {
    const { db, yes, no } = await fixture();
    try {
      await vote(db, yes, no);
      expect(await processHu2011ElectoralMandate(db, GAME, 1006, NOW)).toBe(true);
      await db
        .collection<StringRecord>("states")
        .insertMany(huRegions1991.map((row) => ({ ...row })));
      const playerId = new ObjectId();
      await db.collection("characters").insertOne({
        _id: playerId,
        countryId: "HU",
        party: "1",
        name: "Synthetic Deputy",
        balance: 777,
        currentOffice: null,
        careerHistory: [],
        userId: new ObjectId(),
      });
      const cast: Array<{
        electionId: ObjectId;
        totalVotes: Record<string, number>;
        candidateParties: Record<string, string>;
      }> = [];
      for (const [index, region] of huRegions1991.entries()) {
        const electionId = new ObjectId();
        await db.collection("elections").insertOne({
          _id: electionId,
          countryId: "HU",
          electionType: "nationalAssembly",
          state: String(region._id),
          cycle: 6,
          electionYear: 2014,
          status: "active",
          primaryEndTurn: 1110,
          endTurn: 1120,
        });
        const totalVotes: Record<string, number> = {},
          candidateParties: Record<string, string> = {};
        for (const party of ["1", "2"]) {
          const owner = new ObjectId(),
            candidate = new ObjectId();
          await db.collection("npps").insertOne({
            _id: owner,
            countryId: "HU",
            party,
            balance: 12345,
            currentOffice: null,
            retiredAt: null,
          });
          await db.collection("electionCandidates").insertOne({
            _id: candidate,
            electionId,
            nppId: owner,
            characterId: owner,
            isNPP: true,
            party,
            characterName: `Synthetic ${region._id} ${party}`,
            status: "active",
            enteredAt: NOW,
          });
          totalVotes[candidate.toHexString()] = party === "1" ? 100000 : 50000;
          candidateParties[candidate.toHexString()] = party;
        }
        if (index === 0) {
          const candidate = new ObjectId();
          await db.collection("electionCandidates").insertOne({
            _id: candidate,
            electionId,
            characterId: playerId,
            isNPP: false,
            party: "1",
            characterName: "Synthetic Deputy",
            status: "active",
            enteredAt: NOW,
          });
          totalVotes[candidate.toHexString()] = 999999;
          candidateParties[candidate.toHexString()] = "1";
        }
        cast.push({ electionId, totalVotes, candidateParties });
        await db
          .collection("electionVoteTallies")
          .insertOne({ electionId, totalVotes: {}, candidateParties: {}, finalized: false });
      }
      expect(await bindHu2011Campaigns(db, GAME as never, 1009, NOW)).toBe(true);
      for (const row of cast)
        await db
          .collection("electionVoteTallies")
          .updateOne(
            { electionId: row.electionId },
            { $set: { totalVotes: row.totalVotes, candidateParties: row.candidateParties } }
          );
      await db.collection("elections").updateMany({ cycle: 6 }, { $set: { status: "completed" } });
      commands = commandBytes = replyBytes = 0;
      const receipt = await certifyHu2011Count(db, 6, 1120, NOW);
      expect(receipt?.installed.mandates).toHaveLength(199);
      expect(receipt?.constituencies).toHaveLength(106);
      expect(new Set(receipt?.constituencies?.map((row) => row.id)).size).toBe(106);
      expect(new Set(receipt?.constituencies?.map((row) => row.regionId)).size).toBe(6);
      expect(receipt?.installed.mandates.filter((row) => !row.isNpc)).toHaveLength(1);
      const fail = new Proxy(db, {
        get(target, key) {
          if (key !== "collection") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (name: string) => {
            const collection = target.collection(name);
            if (name !== HU_2011_COUNTS_COLLECTION) return collection;
            return new Proxy(collection, {
              get(inner, property) {
                if (property === "updateOne")
                  return async () => {
                    throw new Error("injected modern handover failure");
                  };
                const value = Reflect.get(inner, property);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        },
      });
      await expect(seatHu2011Assembly(fail, 6, 1120, NOW)).rejects.toThrow(
        "injected modern handover failure"
      );
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
      expect(
        (await db.collection<StringRecord>("gameState").findOne({ _id: "current" }))
          ?.huAssemblyReformedAtYear
      ).toBeUndefined();
      expect(await db.collection("notifications").countDocuments()).toBe(0);
      await db
        .collection<StringRecord>("gameState")
        .updateOne({ _id: "current" }, { $set: { currentTurn: 1120 } });
      commands = commandBytes = replyBytes = 0;
      expect(await resolveGeneralElections(NOW, [cast[0].electionId])).toBe(0);
      expect(await db.collection("electedOfficials").countDocuments()).toBe(386);
      const resolutions = await Promise.all([
        resolveGeneralElections(NOW),
        resolveGeneralElections(NOW),
      ]);
      expect(resolutions.sort()).toEqual([0, 6]);
      console.log({
        fixture: "hu-2011-native-count-and-handover",
        commands,
        commandBytes,
        replyBytes,
      });
      expect(
        await db
          .collection("electedOfficials")
          .countDocuments({ countryId: "HU", officeType: "assemblyDelegate" })
      ).toBe(199);
      expect(
        await db.collection("electedOfficials").countDocuments({ characterId: playerId })
      ).toBe(1);
      expect(await db.collection("electedOfficials").countDocuments({ seatSource: "direct" })).toBe(
        106
      );
      expect(await db.collection("electedOfficials").countDocuments({ seatSource: "list" })).toBe(
        93
      );
      expect(await db.collection("npps").countDocuments()).toBe(12);
      expect(await db.collection("npps").countDocuments({ balance: 12345 })).toBe(12);
      expect((await db.collection("characters").findOne({ _id: playerId }))?.balance).toBe(777);
      expect(
        (await db.collection<StringRecord>("governmentFormations").findOne({ _id: "HU" }))
          ?.totalSeats
      ).toBe(199);
      expect(
        (await db.collection<StringRecord>("gameState").findOne({ _id: "current" }))
          ?.huAssemblyReformedAtYear
      ).toBe(2014);
      expect(await db.collection("notifications").countDocuments()).toBe(1);
      expect(await seatHu2011Assembly(db, 6, 1121, NOW)).toBe(false);
      const departed = await db
        .collection("electedOfficials")
        .findOne({ countryId: "HU", seatSource: "list", isNPP: true, party: "1" });
      expect(departed).not.toBeNull();
      await db.collection("electedOfficials").deleteOne({ _id: departed!._id });
      const vacancies = await loadHu1991ListVacancies(db, 1122);
      expect(vacancies).toHaveLength(1);
      expect(vacancies[0].receiptId).toBe(receipt!._id);
      expect(vacancies[0].candidates.length).toBeGreaterThan(0);
      // Receipts shipped before national-list metadata retain their stored people order.
      await db
        .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
        .updateOne(
          { _id: receipt!._id },
          { $unset: { "nominations.national": "", "nominations.territorial": "" } }
        );
      expect(await loadHu1991ListVacancies(db, 1122)).toEqual(vacancies);
      expect(
        (
          await db
            .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
            .findOne({ _id: receipt!._id })
        )?.nominations.national
      ).toBeUndefined();
      const chair = new ObjectId();
      await db.collection("politicalParties").insertOne({
        countryId: "HU",
        sequentialId: 1,
        chairId: chair,
      });
      expect(await advanceHu1991ListVacancy(db, 1122, NOW)).toBe(false);
      const person = vacancies[0].candidates.find(
        (row) =>
          receipt!.nominations.people.find((p) => p.id === row.personId)?.ownerId !==
          departed!.nppId.toHexString()
      )!;
      expect(person).toBeDefined();
      const designation = {
        db,
        turn: 1122,
        now: NOW,
        receiptId: vacancies[0].receiptId,
        slotPersonId: vacancies[0].slotPersonId,
        personId: person.personId,
        actor: { characterId: chair, isAdmin: false },
      };
      await expect(
        designateHu1991ListDeputy({
          ...designation,
          actor: { characterId: new ObjectId(), isAdmin: false },
        })
      ).rejects.toThrow("Only this party's chair");
      const ownerMirrors = await db.collection("npps").find().sort({ _id: 1 }).toArray();
      const failReplacement = new Proxy(db, {
        get(target, key) {
          if (key !== "collection") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (name: string) => {
            const collection = target.collection(name);
            if (name !== HU_1991_LIST_REPLACEMENTS_COLLECTION) return collection;
            return new Proxy(collection, {
              get(inner, property) {
                if (property === "insertOne")
                  return async () => {
                    throw new Error("injected modern replacement journal failure");
                  };
                const value = Reflect.get(inner, property);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        },
      });
      await expect(
        designateHu1991ListDeputy({ ...designation, db: failReplacement })
      ).rejects.toThrow("injected modern replacement journal failure");
      expect(await db.collection("electedOfficials").countDocuments()).toBe(198);
      expect(await db.collection("npps").find().sort({ _id: 1 }).toArray()).toEqual(ownerMirrors);
      expect(await db.collection(HU_1991_LIST_REPLACEMENTS_COLLECTION).countDocuments()).toBe(0);
      expect(await loadHu1991ListVacancies(db, 1122)).toEqual(vacancies);
      commands = commandBytes = replyBytes = 0;
      const designations = await Promise.all([
        designateHu1991ListDeputy(designation),
        designateHu1991ListDeputy(designation),
      ]);
      expect(designations.sort()).toEqual([false, true]);
      process.stdout.write(
        JSON.stringify({
          fixture: "hu-modern-list-replacement-concurrent",
          commands,
          commandBytes,
          replyBytes,
        }) + "\n"
      );
      expect(await designateHu1991ListDeputy(designation)).toBe(false);
      expect(await db.collection(HU_1991_LIST_REPLACEMENTS_COLLECTION).countDocuments()).toBe(1);
      expect(
        await db.collection("electedOfficials").countDocuments({
          countryId: "HU",
          officeType: "assemblyDelegate",
        })
      ).toBe(199);
      const replacement = await db.collection("electedOfficials").findOne({
        "hungarianAssemblyMandate.personId": person.personId,
      });
      expect(replacement?.termEnds).toEqual(departed!.termEnds);
      for (const owner of await db.collection("npps").find().toArray()) {
        const held = await db.collection("electedOfficials").countDocuments({ nppId: owner._id });
        expect(owner.seatsHeld).toBe(held);
        expect(owner.currentOffice.seatsHeld).toBe(held);
      }
      expect(await db.collection("npps").countDocuments()).toBe(12);
      expect(await db.collection("npps").countDocuments({ balance: 12345 })).toBe(12);
      expect(await loadHu1991ListVacancies(db, 1122)).toHaveLength(0);
      const direct = await db.collection("electedOfficials").findOne({
        countryId: "HU",
        seatSource: "direct",
        isNPP: true,
      });
      await db.collection("electedOfficials").deleteOne({ _id: direct!._id });
      const lists = await db
        .collection("electedOfficials")
        .find({ seatSource: "list" })
        .sort({ _id: 1 })
        .toArray();
      commands = commandBytes = replyBytes = 0;
      const openings = await Promise.all([
        openHuModernByElections(db, 1123, NOW),
        openHuModernByElections(db, 1123, NOW),
      ]);
      expect(openings[0]).toEqual(openings[1]);
      expect(openings[0]).toHaveLength(1);
      process.stdout.write(
        JSON.stringify({
          fixture: "hu-modern-by-election-opening-concurrent",
          commands,
          commandBytes,
          replyBytes,
        }) + "\n"
      );
      const vacancyPoll = await db
        .collection("elections")
        .findOne({ _id: new ObjectId(openings[0][0]) });
      expect(vacancyPoll?.totalSeats).toBe(1);
      expect(vacancyPoll?.hungarianModernByElection).toMatchObject({
        parentReceiptId: receipt!._id,
        districtId: direct!.constituencyId,
      });
      expect(vacancyPoll?.hungarianModernByElection.registeredVoters).toBeGreaterThan(0);
      expect(await db.collection(HU_2011_BY_ELECTIONS_COLLECTION).countDocuments()).toBe(1);
      expect(
        await db.collection("electionCandidates").countDocuments({ electionId: vacancyPoll!._id })
      ).toBe(2);
      expect(
        await db
          .collection("electedOfficials")
          .find({ seatSource: "list" })
          .sort({ _id: 1 })
          .toArray()
      ).toEqual(lists);
      expect(await db.collection("npps").countDocuments()).toBe(12);
      // A completed legacy modern settlement must not borrow an old native slate.
      await db
        .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
        .deleteOne({ _id: receipt!._id });
      await db.collection<StringRecord>("hu1991AssemblyCounts").insertOne({
        ...receipt!,
        _id: "HU:mixed1989:legacy",
        seatedAtTurn: 1120,
      });
      expect(await loadHu1991ListVacancies(db, 1122)).toEqual([]);
    } finally {
      await db.dropDatabase();
    }
  });
  it("introduces a bounded NPC supermajority decision once and respects human or rejected choices", async () => {
    const { db, yes } = await fixture(258, 128);
    try {
      await db.collection("npps").insertOne({
        _id: yes,
        countryId: "HU",
        party: "1",
        currentOffice: { type: "primeMinister" },
      });
      await db
        .collection<StringRecord>("governmentFormations")
        .updateOne({ _id: "HU" }, { $set: { pmNppId: yes } });
      const human = new ObjectId();
      await db.collection("electedOfficials").insertOne({
        countryId: "HU",
        officeType: "assemblyDelegate",
        characterId: human,
        party: "1",
        seatsHeld: 1,
      });
      expect(await processHu2011ElectoralNpcProposal(db, GAME as never, 1005, NOW)).toBe(false);
      await db.collection("electedOfficials").deleteOne({ characterId: human });
      expect(await processHu2011ElectoralNpcProposal(db, GAME as never, 1005, NOW)).toBe(true);
      expect(await processHu2011ElectoralNpcProposal(db, GAME as never, 1005, NOW)).toBe(false);
      const proposal = await db
        .collection<Hu2011ElectoralProposal>(HU_2011_PROPOSALS_COLLECTION)
        .findOne({});
      expect(proposal?.reason).toBe("npc_government_supermajority_mandate");
      await db
        .collection("bills")
        .updateOne({ _id: proposal!.billId }, { $set: { status: "failed" } });
      expect(await processHu2011ElectoralNpcProposal(db, GAME as never, 1006, NOW)).toBe(false);
      expect(await db.collection("bills").countDocuments()).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
});
