import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { freezeAndApplyDemographicFlowPlan } from "./flowJournal";
import { recoverDemographicFlowsBeforeContext } from "./recoverFlows";

function fixture(journalAttemptStarted = true) {
  const db = createInMemoryDb();
  const state = {
    _id: "current",
    worldEpochId: "recovery-world",
    currentTurn: 7,
    ...(journalAttemptStarted
      ? { demographicFlowAttempt: { worldEpochId: "recovery-world", turn: 8 } }
      : {}),
  } as GameState;
  db.seed("gameState", [state]);
  db.seed("regionDemographics", [{ _id: "R1", ages: { male: [], female: [] } }]);
  db.seed("states", [{ _id: "R1", population: 100 }]);
  db.seed("macroMetrics", [{ _id: "R1" }]);
  return { memory: db, db: db as unknown as Db, state };
}

function plan() {
  const male = Array<number>(101).fill(0);
  const female = Array<number>(101).fill(0);
  male[20] = female[20] = 60;
  return {
    worldEpochId: "recovery-world",
    turn: 8,
    regions: [
      {
        regionId: "R1",
        agesAfter: { male, female },
        stateAfter: {
          population: 120,
          votingEligiblePopulation: 120,
          workingAgePopulation: 120,
          militaryServicePopulation: 0,
        },
        metricsAfter: {
          realizedMigrationRate: 0,
          populationGrowth: 2,
          medianAge: 20,
          sexRatio: 50,
          dependencyRatio: 0,
          demographicDecline: 0,
        },
      },
    ],
    stats: { regionsProcessed: 1, circuitBreakerTrips: 0 },
  };
}

describe("population recovery before resumed context", () => {
  it("retries unpublished journal attempts while preserving other applied phases", async () => {
    const f = fixture();
    const applied = new Set(["demographicFlows", "metricEngine", "fundGeneration"]);
    await recoverDemographicFlowsBeforeContext(f.db, f.state, applied);
    expect([...applied]).toEqual(["metricEngine", "fundGeneration"]);
    expect(f.memory.collection("states").docs[0].population).toBe(100);
  });

  it("keeps a legacy interrupted phase skipped when its old writes are unknown", async () => {
    const f = fixture(false);
    const applied = new Set(["demographicFlows"]);
    await recoverDemographicFlowsBeforeContext(f.db, f.state, applied);
    expect(applied.has("demographicFlows")).toBe(true);
  });

  it("repairs partial population targets before returning the resumed snapshot", async () => {
    const f = fixture();
    const states = f.memory.collection("states");
    const original = states.bulkWrite.bind(states);
    states.bulkWrite = async () => {
      throw new Error("state write interrupted");
    };
    await expect(freezeAndApplyDemographicFlowPlan(f.db, plan())).rejects.toThrow("interrupted");
    expect(states.docs[0].population).toBe(100);
    states.bulkWrite = original;

    const applied = new Set(["demographicFlows"]);
    await recoverDemographicFlowsBeforeContext(f.db, f.state, applied);
    const resumedSnapshot = await f.db.collection("states").findOne({ _id: "R1" });
    expect(resumedSnapshot?.population).toBe(120);
    expect(applied.has("demographicFlows")).toBe(true);
    expect(f.memory.collection("demographicFlowReceipts").docs[0].status).toBe("complete");
  });

  it("aborts recovery rather than overwriting a later population snapshot", async () => {
    const f = fixture();
    const states = f.memory.collection("states");
    const original = states.bulkWrite.bind(states);
    states.bulkWrite = async () => {
      throw new Error("state write interrupted");
    };
    await expect(freezeAndApplyDemographicFlowPlan(f.db, plan())).rejects.toThrow("interrupted");
    states.bulkWrite = original;
    await states.updateOne(
      { _id: "R1" },
      {
        $set: {
          population: 999,
          populationFlowStamp: { worldEpochId: "recovery-world", turn: 9, batchId: "later" },
        },
      }
    );
    const applied = new Set(["demographicFlows"]);
    await expect(recoverDemographicFlowsBeforeContext(f.db, f.state, applied)).rejects.toThrow(
      "stale"
    );
    expect(states.docs[0].population).toBe(999);
    expect(applied.has("demographicFlows")).toBe(true);
  });
});
