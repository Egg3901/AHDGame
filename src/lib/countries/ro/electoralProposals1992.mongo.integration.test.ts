import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "@/lib/turn/onePartyBillLifecycle";
import {
  openRo1992ElectoralProposal,
  processRo1992ElectoralMandate,
  RO_1992_PROPOSALS_COLLECTION,
} from "./electoralProposals1992";
import { processRo1992ElectoralNpcProposal } from "./electoralNpcProposals1992";
import { processRoParliamentTransition } from "@/lib/turn/roParliamentTransition";
import { roRegions1991 } from "./data/roRegions1991";
import { RO_1992_DEPUTIES_BY_REGION, RO_1992_SENATORS_BY_REGION } from "./rules/parliament1992";
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
type StringRow = { _id: string; [key: string]: unknown };
describe.skipIf(!uri)("Romanian1992 decision on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    commandBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Qualification needs explicit isolated loopback Mongo");
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
    const db = client.db(`ahd_test_ro_1992_${new ObjectId().toHexString()}`);
    for (const name of [
      "gameState",
      "countryState",
      "countryGameStates",
      "states",
      "bills",
      RO_1992_PROPOSALS_COLLECTION,
      "elections",
      "electionVoteTallies",
      "electedOfficials",
      "governmentFormations",
    ])
      await db.createCollection(name);
    await db
      .collection<StringRow>("gameState")
      .insertOne({ _id: "current", ...GAME, currentTurn: 73 });
    await db
      .collection<StringRow>("countryState")
      .insertOne({ ...seedCountryStateFromConfig("RO", NOW, "1991-default") });
    await db.collection<StringRow>("countryGameStates").insertOne({ _id: "RO" });
    await db
      .collection<StringRow>("governmentFormations")
      .insertOne({ _id: "RO", status: "formed" });
    await db.collection<StringRow>("states").insertMany(roRegions1991.map((row) => ({ ...row })));
    const lower = Array.from({ length: 396 }, () => new ObjectId()),
      upper = Array.from({ length: 119 }, () => new ObjectId());
    await db
      .collection("electedOfficials")
      .insertMany([
        ...lower.map((nppId) => ({ countryId: "RO", officeType: "deputy", nppId, seatsHeld: 1 })),
        ...upper.map((nppId) => ({ countryId: "RO", officeType: "senator", nppId, seatsHeld: 1 })),
      ]);
    vi.mocked(getDb).mockResolvedValue(db);
    await clock(73);
    return { db, lower, upper };
  }
  async function vote(
    db: Db,
    billId: ObjectId,
    ids: ObjectId[],
    support: number,
    upper: boolean,
    turn: number
  ) {
    await db.collection("bills").updateOne(
      { _id: billId },
      {
        $set: {
          [upper ? "otherChamberVotes" : "votes"]: Object.fromEntries(
            ids.map((id, index) => [`npp_${id}`, index < support ? "for" : "against"])
          ),
          [upper ? "otherChamberVotingEndsOnTurn" : "votingEndsOnTurn"]: turn,
        },
      }
    );
    await clock(turn);
    await processOnePartyBillLifecycleForCountry("RO", NOW);
  }
  it("commits capacity, owner counters and formation together with rollback and replay", async () => {
    const { db } = await fixture();
    try {
      await db
        .collection<StringRow>("countryGameStates")
        .updateOne({ _id: "RO" }, { $set: { roElectoralLaw1992SinceTurn: 76 } });
      const races = (
        [
          ["chamberOfDeputies", RO_1992_DEPUTIES_BY_REGION],
          ["senat", RO_1992_SENATORS_BY_REGION],
        ] as const
      ).flatMap(([electionType, seats]) =>
        Object.entries(seats).map(([state, totalSeats]) => ({
          countryId: "RO",
          electionType,
          cycle: 2,
          status: "resolved",
          state,
          totalSeats,
        }))
      );
      await db.collection("elections").insertMany(races);
      await db.collection("electedOfficials").deleteMany({ countryId: "RO" });
      const person = new ObjectId();
      await db.collection("characters").insertOne({
        _id: person,
        countryId: "RO",
        balance: 777,
        currentOffice: { type: "deputy", state: String(roRegions1991[0]._id), seatsHeld: 1 },
      });
      const owners = roRegions1991.map((region, index) => ({
        _id: new ObjectId(),
        countryId: "RO",
        balance: 666,
        currentOffice: index === 0 ? { type: "primeMinister" } : null,
        seatsHeld: 0,
        region: String(region._id),
      }));
      await db.collection("npps").insertMany(owners);
      const original = roRegions1991.flatMap((region, index) =>
        (
          [
            ["deputy", region.houseDistricts],
            ["senator", region.stateSenateSeats],
          ] as const
        ).map(([officeType, seats]) => ({
          _id: new ObjectId(),
          countryId: "RO",
          state: String(region._id),
          officeType,
          party: "1",
          nppId: owners[index]._id,
          characterId: null,
          seatsHeld: seats - (index === 0 && officeType === "deputy" ? 1 : 0),
          termEnds: new Date("2029-01-01T00:00:00Z"),
        }))
      );
      const human = {
        _id: new ObjectId(),
        countryId: "RO",
        state: String(roRegions1991[0]._id),
        officeType: "deputy",
        party: "1",
        characterId: person,
        nppId: null,
        seatsHeld: 1,
        termEnds: new Date("2029-01-01T00:00:00Z"),
      };
      await db.collection("electedOfficials").insertMany([...original, human]);
      const failing = new Proxy(db, {
        get(target, key) {
          if (key !== "collection") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (name: string) => {
            const collection = target.collection(name);
            if (name !== "countryGameStates") return collection;
            return new Proxy(collection, {
              get(inner, property) {
                if (property === "updateOne")
                  return async () => {
                    throw new Error("injected Romanian handover marker failure");
                  };
                const value = Reflect.get(inner, property);
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
          };
        },
      });
      await expect(processRoParliamentTransition(failing, GAME, 288, NOW)).rejects.toThrow(
        "injected Romanian handover marker failure"
      );
      expect(await db.collection("npps").countDocuments({ seatsHeld: 0 })).toBe(owners.length);
      const before = await db.collection<StringRow>("states").find({ countryId: "RO" }).toArray();
      expect(before.reduce((n, row) => n + Number(row.houseDistricts), 0)).toBe(396);
      expect(
        (await db.collection<StringRow>("countryGameStates").findOne({ _id: "RO" }))
          ?.roParliament1992SinceTurn
      ).toBeUndefined();
      const duplicate = { ...human, _id: new ObjectId(), officeType: "senator" };
      await db.collection("electedOfficials").insertOne(duplicate);
      await expect(processRoParliamentTransition(db, GAME, 288, NOW)).rejects.toThrow(
        "cannot hold duplicate parliamentary seats"
      );
      expect(
        (await db.collection<StringRow>("countryGameStates").findOne({ _id: "RO" }))
          ?.roParliament1992SinceTurn
      ).toBeUndefined();
      expect(await db.collection("npps").countDocuments({ seatsHeld: 0 })).toBe(owners.length);
      await db.collection("electedOfficials").deleteOne({ _id: duplicate._id });
      commands = commandBytes = replyBytes = 0;
      const result = await Promise.all([
        processRoParliamentTransition(db, GAME, 288, NOW),
        processRoParliamentTransition(db, GAME, 288, NOW),
      ]);
      expect(result.sort()).toEqual([false, true]);
      process.stdout.write(
        JSON.stringify({
          fixture: "ro1992-handover-concurrent",
          commands,
          commandBytes,
          replyBytes,
        }) + "\n"
      );
      expect(commands).toBeLessThanOrEqual(70);
      const held = await db.collection("electedOfficials").find({ countryId: "RO" }).toArray();
      expect(
        held.filter((row) => row.officeType === "deputy").reduce((n, row) => n + row.seatsHeld, 0)
      ).toBe(341);
      expect(
        held.filter((row) => row.officeType === "senator").reduce((n, row) => n + row.seatsHeld, 0)
      ).toBe(143);
      expect(held.find((row) => row.characterId?.equals(person))?.seatsHeld).toBe(1);
      expect(held.find((row) => row.characterId?.equals(person))?.termEnds).toEqual(human.termEnds);
      expect(await db.collection("npps").countDocuments()).toBe(owners.length);
      expect(await db.collection("npps").countDocuments({ balance: 666 })).toBe(owners.length);
      expect((await db.collection("characters").findOne({ _id: person }))?.balance).toBe(777);
      for (const owner of await db.collection("npps").find().toArray())
        expect(owner.seatsHeld).toBe(
          held
            .filter((row) => row.nppId?.equals(owner._id))
            .reduce((n, row) => n + row.seatsHeld, 0)
        );
      expect((await db.collection("npps").findOne({ _id: owners[0]._id }))?.currentOffice).toEqual({
        type: "primeMinister",
      });
      commands = commandBytes = replyBytes = 0;
      expect(await processRoParliamentTransition(db, GAME, 289, NOW)).toBe(false);
      process.stdout.write(
        JSON.stringify({ fixture: "ro1992-handover-replay", commands, commandBytes, replyBytes }) +
          "\n"
      );
      expect(commands).toBe(1);
    } finally {
      await db.dropDatabase();
    }
  });
  it.each([false, true])(
    "opens one NPC decision only with no player legislators (%s)",
    async (human) => {
      const { db, lower, upper } = await fixture();
      try {
        const leader = new ObjectId();
        await db
          .collection("npps")
          .insertOne({ _id: leader, countryId: "RO", party: "1", balance: 777 });
        await db
          .collection<StringRow>("governmentFormations")
          .updateOne({ _id: "RO" }, { $set: { pmNppId: leader } });
        await db.collection("electedOfficials").updateMany({}, { $set: { party: "2" } });
        await db
          .collection("electedOfficials")
          .updateMany(
            { nppId: { $in: [...lower.slice(0, 199), ...upper.slice(0, 60)] } },
            { $set: { party: "1" } }
          );
        if (human)
          await db
            .collection("electedOfficials")
            .updateOne({ nppId: lower[0] }, { $set: { characterId: new ObjectId() } });
        expect(await processRo1992ElectoralNpcProposal(db, { ...GAME } as never, 73, NOW)).toBe(
          !human
        );
        expect(await processRo1992ElectoralNpcProposal(db, { ...GAME } as never, 74, NOW)).toBe(
          false
        );
        expect(await db.collection("bills").countDocuments()).toBe(human ? 0 : 1);
        if (!human) {
          const bill = await db.collection("bills").findOne({ countryId: "RO" });
          await db
            .collection("bills")
            .updateOne({ _id: bill!._id }, { $set: { status: "failed" } });
          expect(await processRo1992ElectoralNpcProposal(db, { ...GAME } as never, 75, NOW)).toBe(
            false
          );
        }
        expect((await db.collection("npps").findOne({ _id: leader }))?.balance).toBe(777);
      } finally {
        await db.dropDatabase();
      }
    }
  );
  it.each([
    [199, 60, true, "untouched"],
    [199, 60, true, "counted"],
    [199, 60, true, "late"],
    [198, 60, false, "untouched"],
    [199, 59, false, "untouched"],
  ])(
    "requires both actual full-membership votes%i/%i (%s/%s)",
    async (lowerVotes, upperVotes, approved, mode) => {
      const { db, lower, upper } = await fixture();
      try {
        const campaign = roRegions1991.flatMap((region) =>
          (["chamberOfDeputies", "senat"] as const).map((electionType) => ({
            _id: new ObjectId(),
            countryId: "RO",
            electionType,
            state: String(region._id),
            cycle: 1,
            status: "active",
            primaryEndTurn: mode === "late" ? 75 : 80,
            totalSeats: electionType === "senat" ? region.stateSenateSeats : region.houseDistricts,
          }))
        );
        await db.collection("elections").insertMany(campaign);
        await db.collection("electionVoteTallies").insertMany(
          campaign.map((row, index) => ({
            electionId: row._id,
            finalized: false,
            totalVotes: mode === "counted" && index === 0 ? { prior: 1 } : {},
          }))
        );
        const proposal = await openRo1992ElectoralProposal({
          db,
          game: GAME,
          turn: 73,
          now: NOW,
          sponsor: null,
        });
        await processOnePartyBillLifecycleForCountry("RO", NOW);
        expect(await processRo1992ElectoralMandate(db, GAME, 73, NOW)).toBe(false);
        await vote(db, proposal.billId, lower, lowerVotes, false, 74);
        if (lowerVotes > 198) {
          expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
            "active_other"
          );
          await vote(db, proposal.billId, upper, upperVotes, true, 75);
        }
        if (approved) {
          expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
            "enrolled"
          );
          expect(await processRo1992ElectoralMandate(db, GAME, 75, NOW)).toBe(false);
          await db
            .collection("bills")
            .updateOne({ _id: proposal.billId }, { $set: { presidentActionDeadlineOnTurn: 76 } });
          await clock(76);
          await processOnePartyBillLifecycleForCountry("RO", NOW);
        }
        expect((await db.collection("bills").findOne({ _id: proposal.billId }))?.status).toBe(
          approved ? "signed" : "failed"
        );
        if (approved && mode === "untouched") {
          const failing = new Proxy(db, {
            get(target, key) {
              if (key !== "collection") {
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              }
              return (name: string) => {
                const collection = target.collection(name);
                if (name !== "countryGameStates") return collection;
                return new Proxy(collection, {
                  get(inner, property) {
                    if (property === "updateOne")
                      return async () => {
                        throw new Error("injected Romanian authority failure");
                      };
                    const value = Reflect.get(inner, property);
                    return typeof value === "function" ? value.bind(inner) : value;
                  },
                });
              };
            },
          });
          await expect(processRo1992ElectoralMandate(failing, GAME, 76, NOW)).rejects.toThrow(
            "injected Romanian authority failure"
          );
          const rolledBack = await db
            .collection("elections")
            .find({ cycle: 1, electionType: "chamberOfDeputies" })
            .toArray();
          expect(rolledBack.reduce((n, row) => n + row.totalSeats, 0)).toBe(396);
          expect(
            (await db.collection<StringRow>("countryGameStates").findOne({ _id: "RO" }))
              ?.roElectoralLaw1992SinceTurn
          ).toBeUndefined();
          expect(
            (
              await db
                .collection<StringRow>(RO_1992_PROPOSALS_COLLECTION)
                .findOne({ _id: proposal._id })
            )?.status
          ).toBe("open");
        }
        commands = commandBytes = replyBytes = 0;
        expect(await processRo1992ElectoralMandate(db, GAME, 76, NOW)).toBe(approved);
        process.stdout.write(
          JSON.stringify({
            fixture: "ro1992-authority",
            mode,
            commands,
            commandBytes,
            replyBytes,
          }) + "\n"
        );
        expect(
          (await db.collection<StringRow>("countryGameStates").findOne({ _id: "RO" }))
            ?.roElectoralLaw1992SinceTurn
        ).toBe(approved ? 76 : undefined);
        expect(await db.collection("electedOfficials").countDocuments()).toBe(515);
        const storedCampaign = await db.collection("elections").find({ cycle: 1 }).toArray();
        expect(
          storedCampaign
            .filter((row) => row.electionType === "chamberOfDeputies")
            .reduce((n, row) => n + row.totalSeats, 0)
        ).toBe(approved && mode === "untouched" ? 341 : 396);
        expect(
          storedCampaign
            .filter((row) => row.electionType === "senat")
            .reduce((n, row) => n + row.totalSeats, 0)
        ).toBe(approved && mode === "untouched" ? 143 : 119);

        expect(await processRoParliamentTransition(db, GAME, 96, NOW)).toBe(false);
        if (approved) {
          const races = (
            [
              ["chamberOfDeputies", RO_1992_DEPUTIES_BY_REGION],
              ["senat", RO_1992_SENATORS_BY_REGION],
            ] as const
          ).flatMap(([electionType, seats]) =>
            Object.entries(seats).map(([state, totalSeats]) => ({
              countryId: "RO",
              electionType,
              cycle: 2,
              status: "resolved",
              state,
              totalSeats,
            }))
          );
          await db.collection("elections").insertMany(races);
          // The sitting aggregate delegates are replaced by a completed bounded fixture slate.
          await db.collection("electedOfficials").deleteMany({ countryId: "RO" });
          await db.collection("electedOfficials").insertMany(
            races.map((row) => ({
              countryId: "RO",
              officeType: row.electionType === "senat" ? "senator" : "deputy",
              state: row.state,
              nppId: new ObjectId(),
              seatsHeld: row.totalSeats,
            }))
          );
          const holders = await db
            .collection("electedOfficials")
            .find({ countryId: "RO" })
            .toArray();
          await db.collection("npps").insertMany(
            holders.map((row) => ({
              _id: row.nppId,
              countryId: "RO",
              balance: 333,
              currentOffice: null,
            }))
          );
          expect(await processRoParliamentTransition(db, GAME, 288, NOW)).toBe(true);
          expect(await db.collection("npps").countDocuments({ balance: 333 })).toBe(holders.length);
          for (const owner of await db.collection("npps").find().toArray())
            expect(owner.seatsHeld).toBe(
              holders.find((row) => row.nppId.equals(owner._id))!.seatsHeld
            );

          expect(
            (await db.collection<StringRow>("governmentFormations").findOne({ _id: "RO" }))
              ?.totalSeats
          ).toBe(341);
          expect(await processRoParliamentTransition(db, GAME, 289, NOW)).toBe(false);
        }
      } finally {
        await db.dropDatabase();
      }
    }
  );
});
