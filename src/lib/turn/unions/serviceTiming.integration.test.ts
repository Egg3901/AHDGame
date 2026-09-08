import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { buildUnionEffectsById } from "@/lib/unions/unionLookups";
import { loadLabourRelationsPoliticalNudgesByCountry } from "@/lib/unions/labourRelationsPoliticalProvider";
import { averageAnnualWage, servicesCostPerTurn } from "@/lib/unions/unionDues";
import { processUnionsTurn } from "./index";

vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("./labourRelationsTurn", () => ({
  processLabourRelationsTurn: vi.fn().mockResolvedValue({}),
}));

describe("union service funding across turn phases", () => {
  it("does not remove paid service effects when the union phase spends the treasury", async () => {
    const memory = createInMemoryDb();
    const db = {
      collection(name: string) {
        const collection = memory.collection(name);
        if (name === "states" || name === "unions")
          return Object.assign(collection, { distinct: async () => [] });
        return collection;
      },
    } as unknown as Db;
    const unionId = new ObjectId();
    const sector = {
      _id: new ObjectId(),
      representingUnionId: unionId,
      workers: 100,
      unionization: 100,
      wagePerWorker: 100,
    };
    const cost = servicesCostPerTurn(100, averageAnnualWage([sector]), ["healthFund"]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 100 }]);
    memory.seed("gameConfig", [{ _id: "default", labourSystemMode: "full" }]);
    memory.seed("corporateSectors", [sector]);
    memory.seed("unions", [
      {
        _id: unionId,
        countryId: "US",
        ownerId: new ObjectId(),
        ownerType: "npp",
        treasury: cost,
        duesPerWorkerAnnual: 0,
        activeServices: ["healthFund"],
        approval: 60,
        serviceReceipts: [{ turn: 100, services: ["healthFund"] }],
      },
    ]);
    // Corporation strikes read first, the union financial pass runs next,
    // then the political board reads worker-security services.
    const before = await buildUnionEffectsById(db, 100);
    await processUnionsTurn(db);
    const after = await buildUnionEffectsById(db, 100);
    expect(after.get(unionId.toString())?.approval).toBe(61.5);
    expect(after.get(unionId.toString())?.activeServices).toEqual(
      before.get(unionId.toString())?.activeServices
    );
    expect(
      (await loadLabourRelationsPoliticalNudgesByCountry(db, 100))
        .get("US")
        ?.get("economy.workerSecurity")
    ).toBe(1.2);
  });
  it("buys next turn services without granting legacy unions free effects this turn", async () => {
    const memory = createInMemoryDb();
    const db = {
      collection(name: string) {
        const collection = memory.collection(name);
        if (name === "states" || name === "unions")
          return Object.assign(collection, { distinct: async () => [] });
        return collection;
      },
    } as unknown as Db;
    const unionId = new ObjectId();
    memory.seed("gameState", [{ _id: "current", currentTurn: 99 }]);
    memory.seed("corporateSectors", [
      {
        _id: new ObjectId(),
        representingUnionId: unionId,
        workers: 100,
        unionization: 100,
        wagePerWorker: 100,
      },
    ]);
    memory.seed("unions", [
      {
        _id: unionId,
        countryId: "US",
        ownerId: new ObjectId(),
        ownerType: "npp",
        treasury: 1000,
        duesPerWorkerAnnual: 0,
        activeServices: ["healthFund"],
        approval: 75,
      },
    ]);
    expect((await buildUnionEffectsById(db, 100)).get(unionId.toString())?.activeServices).toEqual(
      []
    );
    await processUnionsTurn(db, 100);
    expect((await buildUnionEffectsById(db, 100)).get(unionId.toString())?.activeServices).toEqual(
      []
    );
    expect((await buildUnionEffectsById(db, 101)).get(unionId.toString())?.activeServices).toEqual([
      "healthFund",
    ]);
    expect((await buildUnionEffectsById(db, 102)).get(unionId.toString())?.activeServices).toEqual(
      []
    );
    // A newly selected slate cannot rewrite an entitlement already paid for.
    await db.collection("unions").updateOne({ _id: unionId }, { $set: { activeServices: [] } });
    await processUnionsTurn(db, 101);
    expect((await buildUnionEffectsById(db, 101)).get(unionId.toString())?.activeServices).toEqual([
      "healthFund",
    ]);
    expect((await buildUnionEffectsById(db, 102)).get(unionId.toString())?.activeServices).toEqual(
      []
    );
    expect(memory.collection("unions").docs[0].serviceReceipts).toEqual([
      { turn: 101, services: ["healthFund"] },
      { turn: 102, services: [] },
    ]);
  });
});
