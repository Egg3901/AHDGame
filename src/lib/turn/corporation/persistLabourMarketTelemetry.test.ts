import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { persistLabourDemand } from "./corporationTurnPhases";

function macroMetrics(db: MockDb) {
  db.collection("macroMetrics");
  return db.collectionMocks.macroMetrics;
}

function stubRegions(db: MockDb, ids: string[]) {
  macroMetrics(db).find.mockReturnValue({
    project: () => ({ toArray: async () => ids.map((_id) => ({ _id })) }),
  });
}

function bulkWriteArg(db: MockDb) {
  const calls = macroMetrics(db).bulkWrite.mock.calls;
  expect(calls.length).toBe(1);
  return calls[0][0] as Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, number> };
    };
  }>;
}

function updateFor(db: MockDb, stateId: string) {
  const op = bulkWriteArg(db).find((o) => o.updateOne.filter._id === stateId);
  expect(op, `no write for ${stateId}`).toBeDefined();
  return op!.updateOne.update.$set;
}

describe("persistLabourDemand", () => {
  it("records this turn's desired headcount and wage bid, without overwriting prior tightness", async () => {
    const db: MockDb = createMockDb();
    stubRegions(db, ["AZ", "NY"]);

    await persistLabourDemand({
      db: db as unknown as Db,
      labourDemandByState: new Map([
        ["AZ", 62_738_464],
        ["NY", 1_250],
      ]),
      labourDemandWageIndexByState: new Map([["AZ", 1.15]]),
      turn: 338,
    });

    expect(updateFor(db, "AZ")).toEqual({
      "economic.labourDemand.value": 62_738_464,
      "economic.labourDemandWageIndex.value": 1.15,
      "economic.labourDemandTurn": 338,
    });
    expect(updateFor(db, "NY")).toEqual({
      "economic.labourDemand.value": 1_250,
      "economic.labourDemandWageIndex.value": 1,
      "economic.labourDemandTurn": 338,
    });
  });

  it("writes zero demand for regions with no corporate sectors to clear stale telemetry", async () => {
    const db: MockDb = createMockDb();
    stubRegions(db, ["AZ", "NY"]);

    await persistLabourDemand({
      db: db as unknown as Db,
      labourDemandByState: new Map([["AZ", 1_000]]),
      turn: 12,
    });

    expect(updateFor(db, "NY")).toEqual({
      "economic.labourDemand.value": 0,
      "economic.labourDemandWageIndex.value": 1,
      "economic.labourDemandTurn": 12,
    });
  });

  it("writes zero demand to every region when no sectors were processed", async () => {
    const db: MockDb = createMockDb();
    stubRegions(db, ["AZ", "NY"]);

    await persistLabourDemand({
      db: db as unknown as Db,
      labourDemandByState: new Map(),
      turn: 5,
    });

    expect(updateFor(db, "AZ")["economic.labourDemand.value"]).toBe(0);
    expect(updateFor(db, "NY")["economic.labourDemand.value"]).toBe(0);
  });

  it("does not stamp demand when the turn is unknown", async () => {
    const db: MockDb = createMockDb();
    await persistLabourDemand({
      db: db as unknown as Db,
      labourDemandByState: new Map([["AZ", 1_000]]),
      turn: undefined,
    });
    expect(macroMetrics(db).find).not.toHaveBeenCalled();
    expect(macroMetrics(db).bulkWrite).not.toHaveBeenCalled();
  });
});
