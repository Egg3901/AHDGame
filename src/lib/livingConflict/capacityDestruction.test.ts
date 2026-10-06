import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  applyConflictCapacityDestruction,
  loadCapacityRepairSpending,
  loadRealizedCapacityFraction,
  settleCapacityObligations,
} from "./capacityDestruction";
import { YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION } from "./rules/capacityDestruction";
import type { Crisis, GlobalResponseOutcome } from "@/lib/db/types/crisis";

const crisis = { globalResponse: { conflictKey: "yugoslav_dissolution" } } as unknown as Crisis;
const outcome = {
  outcomeId: "military_escalation",
  label: "Military escalation",
  capacityDestruction: YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION,
} as unknown as GlobalResponseOutcome;

function worldDb(turn = 200) {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({ currentTurn: turn });
  db.collection("states")
    .find()
    .toArray.mockResolvedValue([
      { _id: "YU_CRO", name: "Croatia", countryId: "YU", gdp: 1000, capitalStock: 4000 },
      { _id: "YU_BIH", name: "Bosnia", countryId: "YU", gdp: 500 },
    ]);
  return db;
}

describe("applyConflictCapacityDestruction", () => {
  it("does nothing for an outcome without authored destruction", async () => {
    const db = worldDb();
    const result = await applyConflictCapacityDestruction(
      db as unknown as Db,
      crisis,
      { outcomeId: "x" } as GlobalResponseOutcome,
      "res-1"
    );
    expect(result).toBeUndefined();
    expect(db.collectionMocks.conflictCapacityObligations).toBeUndefined();
  });

  it("writes one deterministic, insert-only obligation per damaged region", async () => {
    const db = worldDb(200);
    const summary = await applyConflictCapacityDestruction(
      db as unknown as Db,
      crisis,
      outcome,
      "res-1"
    );
    const writes = db.collectionMocks.conflictCapacityObligations.bulkWrite.mock
      .calls[0][0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $setOnInsert: Record<string, unknown> };
        upsert: boolean;
      };
    }>;
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.updateOne.filter._id)).toEqual([
      "capacity:yugoslav_dissolution:res-1:YU_CRO",
      "capacity:yugoslav_dissolution:res-1:YU_BIH",
    ]);
    for (const w of writes) {
      expect(w.updateOne.upsert).toBe(true);
      expect(w.updateOne.update).not.toHaveProperty("$set");
    }
    const cro = writes[0].updateOne.update.$setOnInsert;
    expect(cro.destroyedCapital).toBe(20); // 0.5% of the stored 4000
    expect(cro.createdTurn).toBe(200);
    expect(cro.status).toBe("repairing");
    // A region with no stored stock cold-starts at 3x GDP, as the metric engine does.
    expect(writes[1].updateOne.update.$setOnInsert.destroyedCapital).toBe(7.5);
    expect(summary?.regions.map((r) => r.regionId)).toEqual(["YU_CRO", "YU_BIH"]);
    expect(summary?.realizedFraction).toBe(1);
  });

  it("does not write again when the resolution already has its obligations", async () => {
    const db = worldDb();
    const stored = [
      {
        _id: "o1",
        regionId: "YU_CRO",
        countryIdAtDestruction: "YU",
        destroyedCapital: 20,
        realizedFraction: 1,
      },
      {
        _id: "o2",
        regionId: "YU_BIH",
        countryIdAtDestruction: "YU",
        destroyedCapital: 7.5,
        realizedFraction: 1,
      },
    ];
    db.collection("conflictCapacityObligations").find().toArray.mockResolvedValue(stored);
    const summary = await applyConflictCapacityDestruction(
      db as unknown as Db,
      crisis,
      outcome,
      "res-1"
    );
    expect(db.collectionMocks.conflictCapacityObligations.bulkWrite).not.toHaveBeenCalled();
    expect(summary?.regions).toHaveLength(2);
  });
});

describe("repair spending and settlement", () => {
  it("returns nothing, with no clock read, when no obligation is repairing", async () => {
    const db = createMockDb();
    expect(await loadCapacityRepairSpending(db as unknown as Db)).toEqual({});
    expect(db.collectionMocks.gameState).toBeUndefined();
  });

  it("charges the region's current sovereign for the installment turn", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 105 });
    db.collection("conflictCapacityObligations")
      .find()
      .toArray.mockResolvedValue([
        {
          regionId: "YU_CRO",
          countryIdAtDestruction: "YU",
          createdTurn: 100,
          destroyedCapital: 96,
          repairTurns: 96,
          repairCostMultiplier: 1,
        },
      ]);
    // The region has since passed to a successor.
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "YU_CRO", countryId: "HR" }]);
    const spending = await loadCapacityRepairSpending(db as unknown as Db);
    expect(Object.keys(spending)).toEqual(["HR"]);
    expect(spending.HR).toBe(1 * 1_000_000 * 48);
  });

  it("reads the realized fraction of a resolution and settles by id", async () => {
    const db = createMockDb();
    db.collection("conflictCapacityObligations")
      .find()
      .toArray.mockResolvedValue([{ realizedFraction: 0.5 }, { realizedFraction: 0.5 }]);
    expect(await loadRealizedCapacityFraction(db as unknown as Db, "k", "r")).toBe(0.5);
    await settleCapacityObligations(db as unknown as Db, []);
    expect(db.collectionMocks.conflictCapacityObligations.updateMany).not.toHaveBeenCalled();
    await settleCapacityObligations(db as unknown as Db, ["a"]);
    expect(db.collectionMocks.conflictCapacityObligations.updateMany).toHaveBeenCalledOnce();
  });
});
