import { processIndependenceDesireDrift } from "@/lib/turn/independenceDesireDrift";
import { loadIndependenceDesireSnapshots } from "@/lib/governorOffice/devolution/queries";
import { secedeRegion } from "./secede/secedeRegion";
import { transferRegion } from "./transfer/transferRegion";
import { REQUEST_AP_COST } from "@/lib/constants/referendum";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  assertOwnedMongod,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import {
  prepareManagedMongo,
  initializeLocalReplicaSet,
} from "@/lib/singleplayer/prepareManagedMongo";
import { afterCommit, withSessionDb } from "@/lib/db/sessionDb";
import { requestReferendum } from "./requestReferendum";
import { spendGroundGame } from "./groundGame";
import { applyReferendumOutcome } from "./outcome";
import type { Referendum } from "@/lib/db/types/referendum";
vi.mock("@/lib/governorOffice/devolution/queries", () => ({
  loadIndependenceDesireSnapshots: vi.fn(),
}));
vi.mock("./referendumWebhooks", () => ({
  announceReferendumRequested: vi.fn().mockResolvedValue(undefined),
  announceReferendumVoteResult: vi.fn().mockResolvedValue(undefined),
}));

describe.runIf(REAL_MONGO_ENABLED)("atomic referendum lifecycle against owned MongoDB", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-referendum-", { replicaSet: "ahd-local" });
    await assertOwnedMongod(fixture.proc, fixture.client);
    await initializeLocalReplicaSet(fixture.client.db("admin").admin(), new URL(fixture.uri).host);
    db = fixture.db;
  }, 60_000);
  beforeEach(async () => {
    await assertOwnedMongod(fixture!.proc, fixture!.client);
    await db.dropDatabase();
    await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .insertOne({ _id: "current", currentTurn: 100 });
  });
  afterAll(async () => {
    await stopIsolatedMongod(fixture);
  }, 30_000);
  it("reopens the initialized managed database without changing its data", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    try {
      await prepareManagedMongo(fixture!.uri);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(
      (
        await db
          .collection<{ _id: string; currentTurn: number }>("gameState")
          .findOne({ _id: "current" })
      )?.currentTurn
    ).toBe(100);
  });
  it("rolls back cross-collection writes and discards notifications on interruption", async () => {
    const effect = vi.fn(async () => {});
    await expect(
      withSessionDb(db, async (tx) => {
        await tx.collection("syntheticAccounts").insertOne({ balance: 100 });
        await tx.collection("syntheticLedger").insertOne({ amount: 100 });
        await afterCommit(tx, effect);
        throw new Error("interruption");
      })
    ).rejects.toThrow("interruption");
    expect(await db.collection("syntheticAccounts").countDocuments()).toBe(0);
    expect(await db.collection("syntheticLedger").countDocuments()).toBe(0);
    expect(effect).not.toHaveBeenCalled();
  });
  it("serializes racing referendum requests and charges only the winner", async () => {
    await db
      .collection("governorOfficeState")
      .insertOne({ countryId: "UK", stateId: "SCO", gubernatorialActions: 5 });
    await db
      .collection<{ _id: string; independenceDesire: { value: number } }>("macroMetrics")
      .insertOne({ _id: "SCO", independenceDesire: { value: 70 } });
    const results = await Promise.all([
      requestReferendum(db, { countryId: "UK", stateId: "SCO" }),
      requestReferendum(db, { countryId: "UK", stateId: "SCO" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await db.collection("referendums").countDocuments()).toBe(1);
    expect(
      (await db.collection("governorOfficeState").findOne({ stateId: "SCO" }))?.gubernatorialActions
    ).toBe(5 - REQUEST_AP_COST);
  });
  it("retains both paid ground-game effects under concurrent spending", async () => {
    const refId = new ObjectId();
    const characterId = new ObjectId();
    await db.collection("referendums").insertOne({
      _id: refId,
      countryId: "UK",
      regionId: "SCO",
      kind: "independence",
      status: "campaigning",
      campaignCloseTurn: 150,
      campaignBaseYesShare: 60,
      yesShare: 60,
      cohortBaseline: [{ groupId: "all", share: 1, turnout: 60, yesLean: 60 }],
    });
    await db
      .collection("characters")
      .insertOne({ _id: characterId, actions: 10, currencyBalances: { campaign: 1000000 } });
    const input = {
      referendumId: String(refId),
      characterId,
      countryId: "UK" as const,
      side: "yes" as const,
      presetId: "press_conference",
      target: "whole" as const,
      mode: "volunteer" as const,
    };
    expect(
      (await Promise.all([spendGroundGame(db, input), spendGroundGame(db, input)])).map(
        (r) => r.status
      )
    ).toEqual([200, 200]);
    const ref = await db.collection("referendums").findOne({ _id: refId });
    expect(ref?.groundGameUnits[0].persuadeYes).toBe(1);
    expect((await db.collection("characters").findOne({ _id: characterId }))?.actions).toBe(8);
  });
  it("rolls back a paid action when its effect write fails", async () => {
    const refId = new ObjectId();
    const characterId = new ObjectId();
    await db.collection("referendums").insertOne({
      _id: refId,
      countryId: "UK",
      regionId: "SCO",
      status: "campaigning",
      campaignCloseTurn: 150,
      campaignBaseYesShare: 60,
      yesShare: 60,
      cohortBaseline: [{ groupId: "all", share: 1, turnout: 60, yesLean: 60 }],
    });
    await db
      .collection("characters")
      .insertOne({ _id: characterId, actions: 10, currencyBalances: { campaign: 1000000 } });
    const faultDb = new Proxy(db, {
      get(target, key) {
        if (key === "collection")
          return (name: string) => {
            const collection = target.collection(name);
            return name === "referendums"
              ? new Proxy(collection, {
                  get(col, method) {
                    if (method === "updateOne")
                      return async () => {
                        throw new Error("effect write failed");
                      };
                    const value = Reflect.get(col, method);
                    return typeof value === "function" ? value.bind(col) : value;
                  },
                })
              : collection;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      spendGroundGame(faultDb, {
        referendumId: String(refId),
        characterId,
        countryId: "UK",
        side: "yes",
        presetId: "press_conference",
        target: "whole",
        mode: "volunteer",
      })
    ).rejects.toThrow("effect write failed");
    expect((await db.collection("characters").findOne({ _id: characterId }))?.actions).toBe(10);
    expect(
      (await db.collection("referendums").findOne({ _id: refId }))?.cohortModifiers
    ).toBeUndefined();
  });
  it("rolls back Scotland's map and budget when later government migration fails", async () => {
    await db
      .collection<{ _id: string; countryId: string; gdp: number; population: number }>("states")
      .insertMany([
        { _id: "SCO", countryId: "UK", gdp: 100, population: 5000000 },
        { _id: "LON", countryId: "UK", gdp: 900, population: 9000000 },
      ]);
    await db.collection<{ _id: string; [key: string]: unknown }>("federalBudget").insertOne({
      _id: "UK",
      countryId: "UK",
      gdp: 1000,
      treasuryBalance: 1000,
      taxBases: { income: 1000 },
      debt: { principal: 0, interestRate: 3 },
    });
    const faultDb = new Proxy(db, {
      get(target, key) {
        if (key === "collection")
          return (name: string) => {
            const collection = target.collection(name);
            return name === "electedOfficials"
              ? new Proxy(collection, {
                  get(col, method) {
                    if (method === "find")
                      return () => {
                        throw new Error("government migration interrupted");
                      };
                    const value = Reflect.get(col, method);
                    return typeof value === "function" ? value.bind(col) : value;
                  },
                })
              : collection;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      secedeRegion(faultDb, { regionId: "SCO", fromCountryId: "UK", currentTurn: 100 })
    ).rejects.toThrow("government migration interrupted");
    expect(await db.collection("states").countDocuments({ countryId: "SCO" })).toBe(0);
    expect(await db.collection<{ _id: string }>("states").findOne({ _id: "SCO" })).not.toBeNull();
    expect(
      await db.collection<{ _id: string }>("federalBudget").findOne({ _id: "SCO" })
    ).toBeNull();
    expect(
      (
        await db
          .collection<{ _id: string; treasuryBalance: number }>("federalBudget")
          .findOne({ _id: "UK" })
      )?.treasuryBalance
    ).toBe(1000);
  });
  it("rolls back Northern Ireland's map and budget if currency conversion cannot finish", async () => {
    await db
      .collection<{ _id: string; countryId: string; gdp: number; population: number }>("states")
      .insertMany([
        { _id: "NIR", countryId: "UK", gdp: 100, population: 1500000 },
        { _id: "LON", countryId: "UK", gdp: 900, population: 9000000 },
      ]);
    await db.collection<{ _id: string; [key: string]: unknown }>("federalBudget").insertMany([
      { _id: "UK", taxBases: { income: 1000 }, baselineStateGrants: 100 },
      { _id: "IE", taxBases: { income: 200 }, baselineStateGrants: 20 },
    ]);
    await expect(
      transferRegion(db, {
        regionId: "NIR",
        fromCountryId: "UK",
        toCountryId: "IE",
        province: "Ulster",
        relocateToRegionId: "LON",
        currentTurn: 100,
      })
    ).rejects.toThrow("exchange rates");
    expect(
      (await db.collection<{ _id: string; countryId: string }>("states").findOne({ _id: "NIR" }))
        ?.countryId
    ).toBe("UK");
    expect(
      (
        await db
          .collection<{ _id: string; baselineStateGrants: number }>("federalBudget")
          .findOne({ _id: "UK" })
      )?.baselineStateGrants
    ).toBe(100);
  });
  it("does not let a stale drift erase a newer referendum Desire change", async () => {
    await db
      .collection<{ _id: string; independenceDesire: { value: number } }>("macroMetrics")
      .insertOne({ _id: "SCO", independenceDesire: { value: 75 } });
    vi.mocked(loadIndependenceDesireSnapshots).mockResolvedValueOnce([
      { stateId: "SCO", previous: 70, next: 70.05, delta: 0.05 } as Awaited<
        ReturnType<typeof loadIndependenceDesireSnapshots>
      >[number],
    ]);
    expect((await processIndependenceDesireDrift(db, 100))?.regionsProcessed).toBe(0);
    expect(
      (
        await db
          .collection<{ _id: string; independenceDesire: { value: number } }>("macroMetrics")
          .findOne({ _id: "SCO" })
      )?.independenceDesire.value
    ).toBe(75);
  });
  it("creates one consent bill when counting is retried concurrently", async () => {
    const ref = {
      _id: new ObjectId(),
      countryId: "UK",
      regionId: "SCO",
      kind: "independence",
      status: "polling",
      result: null,
      yesShare: 65,
    } as Referendum;
    await db.collection("referendums").insertOne(ref);
    const result = { passed: true, finalYesShare: 65, turnout: 60 };
    await Promise.all([
      applyReferendumOutcome(db, ref, result, 100),
      applyReferendumOutcome(db, ref, result, 100),
    ]);
    expect(await db.collection("bills").countDocuments()).toBe(1);
    expect((await db.collection("referendums").findOne({ _id: ref._id }))?.status).toBe(
      "actuating"
    );
  });
});
