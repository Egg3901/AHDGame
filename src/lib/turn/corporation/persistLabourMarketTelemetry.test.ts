import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { persistLabourMarketTelemetry } from "./corporationTurnPhases";

/**
 * Phase 1 labour market telemetry.
 *
 * These assertions pin the two properties that make the measurement trustworthy
 * enough to tune phases 2 and 3 against:
 *
 *  1. an oversubscribed state is recorded at its true multiple, uncapped, and
 *  2. a state whose labour force is unknown records demand but NO tightness,
 *     because unknown supply must never be persisted as infinite tightness.
 *
 * Nothing here should read the fields back into the economy. If a future change
 * makes a mechanic depend on `labourDemand` or `labourTightness`, that is phase
 * 2 or 3 and it needs its own coverage.
 */
function supplyDocs(docs: Array<{ _id: string; laborForce?: number }>) {
  return docs.map((d) => ({
    _id: d._id,
    economic: d.laborForce === undefined ? {} : { laborForce: { value: d.laborForce } },
  }));
}

/**
 * `createMockDb` registers a collection lazily on first `db.collection(name)`,
 * so a test that stubs `find` before the code under test has touched
 * `macroMetrics` would dereference undefined. Touch it first, then stub.
 */
function macroMetrics(db: MockDb) {
  db.collection("macroMetrics");
  return db.collectionMocks.macroMetrics;
}

function stubSupply(db: MockDb, docs: Array<{ _id: string; laborForce?: number }>) {
  macroMetrics(db).find.mockReturnValue({
    project: () => ({ toArray: async () => supplyDocs(docs) }),
  });
}

function bulkWriteArg(db: MockDb) {
  const calls = macroMetrics(db).bulkWrite.mock.calls;
  expect(calls.length).toBe(1);
  return calls[0][0] as Array<{
    updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
  }>;
}

function setFor(db: MockDb, stateId: string) {
  const op = bulkWriteArg(db).find((o) => o.updateOne.filter._id === stateId);
  expect(op, `no write for ${stateId}`).toBeDefined();
  return op!.updateOne.update.$set;
}

describe("persistLabourMarketTelemetry", () => {
  it("records an oversubscribed state at its true multiple without clamping", async () => {
    const db: MockDb = createMockDb();
    stubSupply(db, [{ _id: "AZ", laborForce: 314_613 }]);

    // The live Arizona reading: two extraction sectors wanting roughly 200x the
    // people in the state. Capping this would erase the whole finding.
    await persistLabourMarketTelemetry({
      db: db as unknown as Db,
      labourDemandByState: new Map([["AZ", 62_738_464]]),
      labourDemandWageIndexByState: new Map([["AZ", 1.15]]),
      turn: 338,
    });

    const set = setFor(db, "AZ");
    expect(set["economic.labourDemand.value"]).toBe(62_738_464);
    expect(set["economic.labourTightness.value"]).toBeGreaterThan(199);
    expect(set["economic.labourDemandWageIndex.value"]).toBe(1.15);
    expect(set["economic.labourDemandTurn"]).toBe(338);
  });

  it("records demand but omits tightness when the state has no labour force reading", async () => {
    const db: MockDb = createMockDb();
    stubSupply(db, [{ _id: "XX" }]);

    await persistLabourMarketTelemetry({
      db: db as unknown as Db,
      labourDemandByState: new Map([["XX", 5_000]]),
      turn: 12,
    });

    const set = setFor(db, "XX");
    expect(set["economic.labourDemand.value"]).toBe(5_000);
    expect(set).not.toHaveProperty("economic.labourTightness.value");
  });

  it("omits tightness for a state absent from macroMetrics entirely", async () => {
    const db: MockDb = createMockDb();
    stubSupply(db, []);

    await persistLabourMarketTelemetry({
      db: db as unknown as Db,
      labourDemandByState: new Map([["ZZ", 900]]),
      turn: 1,
    });

    const set = setFor(db, "ZZ");
    expect(set["economic.labourDemand.value"]).toBe(900);
    expect(set).not.toHaveProperty("economic.labourTightness.value");
  });

  it("writes a slack market below 1.0", async () => {
    const db: MockDb = createMockDb();
    stubSupply(db, [{ _id: "NY", laborForce: 5_731_935 }]);

    await persistLabourMarketTelemetry({
      db: db as unknown as Db,
      labourDemandByState: new Map([["NY", 2_865_967]]),
      turn: 338,
    });

    const set = setFor(db, "NY");
    expect(set["economic.labourTightness.value"]).toBeCloseTo(0.5, 2);
  });

  it("writes nothing at all when no sector was processed", async () => {
    const db: MockDb = createMockDb();
    await persistLabourMarketTelemetry({
      db: db as unknown as Db,
      labourDemandByState: new Map(),
      turn: 5,
    });
    expect(macroMetrics(db).bulkWrite).not.toHaveBeenCalled();
    expect(macroMetrics(db).find).not.toHaveBeenCalled();
  });
});
