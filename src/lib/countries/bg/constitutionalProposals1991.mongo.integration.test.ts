/** Founding constituent votes qualify on an isolated transaction-capable database. */
import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import {
  openBg1991ConstitutionalProposal,
  processBg1991ConstitutionalMandate,
  BG_1991_PROPOSALS_COLLECTION,
} from "./constitutionalProposals1991";
import {
  openBg1991AssemblyDissolution,
  processBg1991AssemblyDissolution,
  loadBg1991AssemblyDissolutionDecision,
  BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID,
} from "./assemblyDissolution1991";
import { processBg1991ConstitutionalNpcProposal } from "./constitutionalNpcProposals1991";
import { bgRegions1991 } from "./data/bgRegions1991";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";
import { BG_FOUNDING_COUNTS_COLLECTION } from "./foundingCount1990";
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
const NOW = new Date("2026-10-03T00:00:00Z"),
  GAME = { preset: "1991-default" };
type Row = { _id: string; [key: string]: unknown };
describe.skipIf(!uri)("Bulgarian constituent consent on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    requestBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Qualification requires explicit isolated loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (e) => {
      commands++;
      requestBytes += BSON.calculateObjectSize(e.command);
    });
    client.on("commandSucceeded", (e) => {
      replyBytes += BSON.calculateObjectSize({ reply: e.reply }) - 12;
    });
    await client.connect();
    vi.mocked(getMongoClient).mockResolvedValue(client);
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Qualification requires writable replica set");
  });
  afterAll(async () => {
    await client?.close();
  });
  async function clock(turn: number) {
    vi.mocked(getGameState).mockResolvedValue({ ...GAME, currentTurn: turn } as Awaited<
      ReturnType<typeof getGameState>
    >);
  }
  async function fixture() {
    const db = client.db(`ahd_test_bg_const_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "states",
      "bills",
      BG_1991_PROPOSALS_COLLECTION,
      BG_FOUNDING_COUNTS_COLLECTION,
      "elections",
      "electionVoteTallies",
      "electedOfficials",
      "governmentFormations",
    ])
      await db.createCollection(name);
    await db.collection<Row>("gameState").insertOne({ _id: "current", ...GAME, currentTurn: 25 });
    await db
      .collection<Row>("countryState")
      .insertOne({ ...seedCountryStateFromConfig("BG", NOW, "1991-default") });
    await db.collection<Row>("countryGameStates").insertOne({ _id: "BG" });
    await db.collection<Row>("governmentFormations").insertOne({ _id: "BG", status: "formed" });
    await db.collection<Row>("states").insertMany(bgRegions1991.map((row) => ({ ...row })));
    const ids = Array.from({ length: 400 }, () => new ObjectId());
    await db.collection("electedOfficials").insertMany(
      ids.map((nppId) => ({
        countryId: "BG",
        officeType: "assemblyDeputy",
        nppId,
        seatsHeld: 1,
        party: "1",
      }))
    );
    vi.mocked(getDb).mockResolvedValue(db);
    await clock(25);
    return { db, ids };
  }
  it.each([
    [267, true, "untouched"],
    [266, false, "untouched"],
    [267, true, "counted"],
    [267, true, "snapshot"],
    [267, true, "late"],
    [267, true, "partial"],
    [267, true, "bound"],
    [267, true, "runoff"],
    [267, true, "certified"],
    [267, true, "continuation"],
    [266, false, "continuation"],
    [267, true, "continuation-counted"],
  ] as const)(
    "uses actual constituent vote%d with approval%s and frozen%s campaigns",
    async (support, approved, mode) => {
      const { db, ids } = await fixture();
      try {
        const campaigns = bgRegions1991.map((region) => ({
          _id: new ObjectId(),
          countryId: "BG",
          electionType: "nationalAssembly",
          state: String(region._id),
          cycle: 2,
          status: "active",
          primaryEndTurn: mode === "late" ? 26 : 30,
          totalSeats: region.houseDistricts,
          ...(["bound", "runoff", "certified"].includes(mode)
            ? {
                bulgarianFoundingRound: {
                  ruleVersion: "parallel-1990-v1",
                  receiptId: "BG:founding1990:2",
                  round: mode === "runoff" ? 2 : 1,
                  registeredVoters: 100000,
                  rootElectionId: new ObjectId().toHexString(),
                },
              }
            : {}),
        }));
        if (mode === "partial") campaigns.pop();
        await db.collection("elections").insertMany(campaigns);
        if (mode === "certified")
          await db
            .collection<Row>(BG_FOUNDING_COUNTS_COLLECTION)
            .insertOne({ _id: "BG:founding1990:2", cycle: 99 });
        await db.collection("electionVoteTallies").insertMany(
          campaigns.map((row, i) => ({
            electionId: row._id,
            finalized: false,
            bulgarianFoundingBallot: ["bound", "runoff", "certified"].includes(mode),
            totalVotes:
              ["counted", "continuation-counted"].includes(mode) && i === 0 ? { prior: 1 } : {},
            turnSnapshots:
              mode === "snapshot" && i === 0 ? [{ cumulativeVotes: { prior: 1 } }] : [],
          }))
        );
        const original = await db.collection("elections").find().toArray();
        const originalTallies = await db.collection("electionVoteTallies").find().toArray();
        const proposal = await openBg1991ConstitutionalProposal({
          db,
          game: GAME,
          turn: 25,
          now: NOW,
          sponsor: null,
          disposition: mode.startsWith("continuation") ? "continue" : "dissolve",
        });
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        expect(await processBg1991ConstitutionalMandate(db, GAME, 25, NOW)).toBe(false);
        await db.collection("bills").updateOne(
          { _id: proposal.billId },
          {
            $set: {
              votes: Object.fromEntries(
                ids.map((id, i) => [`npp_${id}`, i < support ? "for" : "against"])
              ),
              votingEndsOnTurn: 26,
            },
          }
        );
        await clock(26);
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
          approved ? "signed" : "failed"
        );
        if (approved && ["untouched", "bound", "continuation"].includes(mode)) {
          const failing = new Proxy(db, {
            get(target, key) {
              if (key !== "collection") {
                const v = Reflect.get(target, key);
                return typeof v === "function" ? v.bind(target) : v;
              }
              return (name: string) => {
                const c = target.collection(name);
                if (name !== "countryGameStates") return c;
                return new Proxy(c, {
                  get(inner, k) {
                    if (k === "updateOne")
                      return async () => {
                        throw new Error("injected constituent marker failure");
                      };
                    const v = Reflect.get(inner, k);
                    return typeof v === "function" ? v.bind(inner) : v;
                  },
                });
              };
            },
          });
          await expect(processBg1991ConstitutionalMandate(failing, GAME, 26, NOW)).rejects.toThrow(
            "injected constituent marker failure"
          );
          expect(await db.collection("elections").find().toArray()).toEqual(original);
          expect(await db.collection("electionVoteTallies").find().toArray()).toEqual(
            originalTallies
          );
          expect(
            (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
              ?.bgConstitution1991SinceTurn
          ).toBeUndefined();
        }
        commands = requestBytes = replyBytes = 0;
        const concurrent = approved && ["untouched", "bound", "continuation"].includes(mode);
        const outcomes = concurrent
          ? await Promise.all([
              processBg1991ConstitutionalMandate(db, GAME, 26, NOW),
              processBg1991ConstitutionalMandate(db, GAME, 26, NOW),
            ])
          : [await processBg1991ConstitutionalMandate(db, GAME, 26, NOW)];
        if (concurrent) expect(outcomes.slice().sort()).toEqual([false, true]);
        const outcome = outcomes.some(Boolean);
        const measure = { commands, requestBytes, replyBytes };
        expect(outcome).toBe(approved);
        expect(commands).toBeLessThanOrEqual(concurrent ? 40 : 18);
        process.stdout.write(`BG1991 ${support}/${mode}: ${JSON.stringify(measure)}\n`);
        const after = await db.collection("elections").find().toArray();
        if (approved && ["untouched", "bound", "continuation"].includes(mode)) {
          expect(Object.fromEntries(after.map((row) => [row.state, row.totalSeats]))).toEqual(
            BG_ORDINARY_ASSEMBLY_SEATS
          );
          expect(after.every((row) => row.bulgarianFoundingRound === undefined)).toBe(true);
          expect(
            after.every(
              (row) =>
                row.startTurn === 26 &&
                row.primaryEndTurn === (mode === "continuation" ? 166 : 30) &&
                row.endTurn === (mode === "continuation" ? 168 : 32) &&
                row.shiftedScheduleEndTurn === (mode === "continuation" ? 168 : 32)
            )
          ).toBe(true);
          expect(
            (await db.collection("electionVoteTallies").find().toArray()).every(
              (row) => row.bulgarianFoundingBallot === undefined
            )
          ).toBe(true);
        } else expect(after).toEqual(original);
        expect(await processBg1991ConstitutionalMandate(db, GAME, 27, NOW)).toBe(false);
        expect(
          (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
            ?.bgConstitution1991SinceTurn
        ).toBe(approved ? 26 : undefined);
        expect(
          (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
            ?.bgGrandAssemblyContinuationSinceTurn
        ).toBe(approved && mode.startsWith("continuation") ? 26 : undefined);
        expect(
          (await db.collection<Row>("states").find().toArray()).reduce(
            (n, row) => n + Number(row.houseDistricts),
            0
          )
        ).toBe(400);
        if (!approved) {
          const revised = await openBg1991ConstitutionalProposal({
            db,
            game: GAME,
            turn: 27,
            now: NOW,
            sponsor: null,
          });
          expect(revised.revision).toBe(2);
        }
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each([
    [201, 199, true, false],
    [200, 200, false, false],
    [101, 100, true, false],
    [100, 101, false, false],
    [200, 0, false, false],
    [201, 199, true, true],
  ] as const)(
    "resolves separate dissolution by ordinary quorum and majority %d/%d",
    async (forVotes, againstVotes, approved, recorded) => {
      const { db, ids } = await fixture();
      try {
        await db
          .collection<Row>("countryGameStates")
          .updateOne(
            { _id: "BG" },
            { $set: { bgConstitution1991SinceTurn: 25, bgGrandAssemblyContinuationSinceTurn: 25 } }
          );
        const polls = bgRegions1991.map((region) => ({
          _id: new ObjectId(),
          countryId: "BG",
          electionType: "nationalAssembly",
          state: region._id,
          cycle: 1,
          status: "active",
          totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[region._id],
          startTurn: 25,
          primaryEndTurn: 166,
          endTurn: 168,
          shiftedScheduleEndTurn: 168,
          startTime: NOW,
          primaryEndTime: NOW,
          endTime: NOW,
          updatedAt: NOW,
        }));
        await db.collection("elections").insertMany(polls);
        await db.collection("electionVoteTallies").insertMany(
          polls.map((row) => ({
            electionId: row._id,
            finalized: false,
            totalVotes: recorded ? { existingBallot: 1 } : {},
            turnSnapshots: [],
          }))
        );
        const proposal = await openBg1991AssemblyDissolution({
          db,
          turn: 25,
          now: NOW,
          sponsor: null,
        });
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        await db.collection("bills").updateOne(
          { _id: proposal.billId },
          {
            $set: {
              votes: Object.fromEntries(
                ids
                  .slice(0, forVotes + againstVotes)
                  .map((id, i) => [`npp_${id}`, i < forVotes ? "for" : "against"])
              ),
              votingEndsOnTurn: 26,
            },
          }
        );
        await clock(26);
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
          approved ? "signed" : "failed"
        );
        const before = await db.collection("elections").find().toArray();
        if (approved) {
          await db.command({
            collMod: BG_1991_PROPOSALS_COLLECTION,
            validator: {
              $or: [
                { _id: { $ne: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID } },
                { status: { $ne: "authorized" } },
              ],
            },
          });
          await expect(processBg1991AssemblyDissolution(db, GAME, 26, NOW)).rejects.toThrow();
          expect(await db.collection("elections").find().toArray()).toEqual(before);
          expect(
            (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
              ?.bgGrandAssemblyDissolutionSinceTurn
          ).toBeUndefined();
          await db.command({ collMod: BG_1991_PROPOSALS_COLLECTION, validator: {} });
        }
        commands = requestBytes = replyBytes = 0;
        const outcomes = approved
          ? await Promise.all([
              processBg1991AssemblyDissolution(db, GAME, 26, NOW),
              processBg1991AssemblyDissolution(db, GAME, 26, NOW),
            ])
          : [await processBg1991AssemblyDissolution(db, GAME, 26, NOW)];
        process.stdout.write(
          `BGcontinuedDissolution ${forVotes}/${againstVotes}: ${JSON.stringify({ commands, requestBytes, replyBytes })}\n`
        );
        expect(commands).toBeLessThanOrEqual(50);
        expect(outcomes.slice().sort()).toEqual(approved ? [false, true] : [false]);
        const after = await db.collection("elections").find().toArray();
        if (approved) {
          if (recorded) expect(after).toEqual(before);
          else
            expect(
              after.every(
                (row) =>
                  row.cycle === 1 &&
                  row.primaryEndTurn === 30 &&
                  row.endTurn === 32 &&
                  row.shiftedScheduleEndTurn === 32
              )
            ).toBe(true);
          expect(
            (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
              ?.bgGrandAssemblyDissolutionSinceTurn
          ).toBe(26);
          expect(await processBg1991AssemblyDissolution(db, GAME, 27, NOW)).toBe(false);
          expect(await db.collection("elections").find().toArray()).toEqual(after);
        } else {
          expect(after).toEqual(before);
          expect((await loadBg1991AssemblyDissolutionDecision(db, 26)).proposal?.canRevise).toBe(
            true
          );
          const revised = await openBg1991AssemblyDissolution({
            db,
            turn: 27,
            now: NOW,
            sponsor: null,
          });
          expect(revised.revision).toBe(2);
          expect(await db.collection("bills").countDocuments()).toBe(2);
        }
      } finally {
        await db.dropDatabase();
      }
    }
  );

  it.each([
    [267, false, false, true],
    [267, true, false, true],
    [100, true, false, true],
    [1, false, false, true],
    [0, true, false, true],
    [267, false, true, false],
  ] as const)(
    "introduces once with own-party seats%d, player deputy%s, player PM%s",
    async (support, human, playerPM, introduced) => {
      const { db, ids } = await fixture();
      try {
        const leader = new ObjectId();
        await db.collection("npps").insertOne({ _id: leader, party: "1", balance: 777 });
        await db
          .collection<Row>("governmentFormations")
          .updateOne(
            { _id: "BG" },
            { $set: { pmNppId: leader, ...(playerPM ? { pmCharacterId: new ObjectId() } : {}) } }
          );
        await db.collection("electedOfficials").updateMany({}, { $set: { party: "2" } });
        if (support)
          await db
            .collection("electedOfficials")
            .updateMany({ nppId: { $in: ids.slice(0, support) } }, { $set: { party: "1" } });
        if (human)
          await db
            .collection("electedOfficials")
            .updateOne({ nppId: ids[0] }, { $set: { characterId: new ObjectId() } });
        const officesBefore = await db.collection("electedOfficials").find().toArray();
        commands = requestBytes = replyBytes = 0;
        expect(
          await processBg1991ConstitutionalNpcProposal(db, { ...GAME } as never, 25, NOW)
        ).toBe(introduced);
        process.stdout.write(
          `BGNPC_DRAFT ${JSON.stringify({ support, human, playerPM, commands, requestBytes, replyBytes })}\n`
        );
        expect(
          await processBg1991ConstitutionalNpcProposal(db, { ...GAME } as never, 26, NOW)
        ).toBe(false);
        expect(await db.collection("bills").countDocuments()).toBe(introduced ? 1 : 0);
        if (introduced) {
          const proposal = await db.collection(BG_1991_PROPOSALS_COLLECTION).findOne({});
          expect(proposal?.disposition).toBe("dissolve");
          expect(proposal?.reason).toBe("npc_government_constituent_mandate");
          expect(
            (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
              ?.bgConstitution1991SinceTurn
          ).toBeUndefined();
          await db
            .collection("bills")
            .updateOne({ countryId: "BG" }, { $set: { status: "failed" } });
          expect(
            await processBg1991ConstitutionalNpcProposal(db, { ...GAME } as never, 27, NOW)
          ).toBe(false);
        }
        expect(await db.collection("electedOfficials").find().toArray()).toEqual(officesBefore);
        expect((await db.collection("npps").findOne({ _id: leader }))?.balance).toBe(777);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each([266, 267])(
    "minority government draft still needs actual%d constituent votes",
    async (support) => {
      const { db, ids } = await fixture();
      try {
        const leader = new ObjectId();
        await db.collection("npps").insertOne({ _id: leader, party: "1", balance: 777 });
        await db
          .collection<Row>("governmentFormations")
          .updateOne({ _id: "BG" }, { $set: { pmNppId: leader } });
        await db
          .collection("electedOfficials")
          .updateMany({ nppId: { $in: ids.slice(100) } }, { $set: { party: "2" } });
        expect(
          await processBg1991ConstitutionalNpcProposal(db, { ...GAME } as never, 25, NOW)
        ).toBe(true);
        const proposal = await db.collection(BG_1991_PROPOSALS_COLLECTION).findOne({});
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        await db.collection("bills").updateOne(
          { _id: proposal!.billId },
          {
            $set: {
              votes: Object.fromEntries(
                ids.map((id, i) => [`npp_${id}`, i < support ? "for" : "against"])
              ),
              votingEndsOnTurn: 26,
            },
          }
        );
        await clock(26);
        await processOnePartyBillLifecycleForCountry("BG", NOW);
        expect((await db.collection("bills").findOne({ _id: proposal!.billId }))?.status).toBe(
          support === 267 ? "signed" : "failed"
        );
        expect(await processBg1991ConstitutionalMandate(db, GAME, 26, NOW)).toBe(support === 267);
        expect((await db.collection("npps").findOne({ _id: leader }))?.balance).toBe(777);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each(["player_pm", "caretaker", "party_changed", "owner_removed"])(
    "rechecks NPC executive custody in the opening transaction after %s",
    async (mode) => {
      const { db } = await fixture();
      try {
        const leader = new ObjectId();
        await db.collection("npps").insertOne({ _id: leader, party: "1", balance: 777 });
        await db
          .collection<Row>("governmentFormations")
          .updateOne({ _id: "BG" }, { $set: { pmNppId: leader } });
        let changed = false;
        const source = new Proxy(db, {
          get(target, key) {
            if (key !== "collection") {
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: string) => {
              const collection = target.collection(name);
              const watched = ["player_pm", "caretaker"].includes(mode)
                ? "governmentFormations"
                : "npps";
              if (name !== watched) return collection;
              return new Proxy(collection, {
                get(inner, member) {
                  if (member === "findOne")
                    return async (...args: Parameters<typeof inner.findOne>) => {
                      const result = await inner.findOne(...args);
                      if (!changed && !args[1]?.session) {
                        changed = true;
                        if (mode === "owner_removed")
                          await db.collection("npps").deleteOne({ _id: leader });
                        else if (mode === "party_changed")
                          await db
                            .collection("npps")
                            .updateOne({ _id: leader }, { $set: { party: "2" } });
                        else
                          await db.collection<Row>("governmentFormations").updateOne(
                            { _id: "BG" },
                            {
                              $set:
                                mode === "player_pm"
                                  ? { pmCharacterId: new ObjectId() }
                                  : { status: "caretaker" },
                            }
                          );
                      }
                      return result;
                    };
                  const value = Reflect.get(inner, member);
                  return typeof value === "function" ? value.bind(inner) : value;
                },
              });
            };
          },
        });
        expect(
          await processBg1991ConstitutionalNpcProposal(source, { ...GAME } as never, 25, NOW)
        ).toBe(false);
        expect(changed).toBe(true);
        expect(await db.collection("bills").countDocuments()).toBe(0);
        expect(await db.collection(BG_1991_PROPOSALS_COLLECTION).countDocuments()).toBe(0);
        expect(
          (await db.collection<Row>("countryGameStates").findOne({ _id: "BG" }))
            ?.bgConstitution1991SinceTurn
        ).toBeUndefined();
      } finally {
        await db.dropDatabase();
      }
    }
  );
});
