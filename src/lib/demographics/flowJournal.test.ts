import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  DEMOGRAPHIC_FLOW_PROJECTIONS,
  DEMOGRAPHIC_FLOW_RECEIPTS,
  freezeAndApplyDemographicFlowPlan,
  loadDemographicFlowReceipt,
  resumeDemographicFlowReceipt,
  resumePendingDemographicFlowReceipts,
  type DemographicFlowMetricsProjection,
  type DemographicFlowRegionInput,
  type DemographicFlowStats,
} from "./flowJournal";

const EPOCH = "test-epoch-a";
const TURN = 8;

function makeRegion(regionId = "R1", population = 100): DemographicFlowRegionInput {
  const male = Array<number>(101).fill(0);
  const female = Array<number>(101).fill(0);
  male[20] = population / 2;
  female[20] = population / 2;
  return {
    regionId,
    agesAfter: { male, female },
    stateAfter: {
      population,
      votingEligiblePopulation: population,
      workingAgePopulation: population,
      militaryServicePopulation: 0,
    },
    metricsAfter: {
      realizedMigrationRate: 1,
      populationGrowth: 2,
      medianAge: 35,
      sexRatio: 98,
      dependencyRatio: 0.5,
      demographicDecline: 0,
    },
  };
}

const stats: DemographicFlowStats = { regionsProcessed: 1, circuitBreakerTrips: 0 };

function fixture(options: { regions?: string[]; epoch?: string } = {}) {
  const db = createInMemoryDb();
  const regionIds = options.regions ?? ["R1"];
  db.seed("gameState", [
    { _id: "current", worldEpochId: options.epoch ?? EPOCH, currentTurn: TURN - 1 },
  ]);
  db.seed(
    "regionDemographics",
    regionIds.map((id) => ({
      _id: id,
      countryId: "TST",
      ages: { male: Array<number>(101).fill(0), female: Array<number>(101).fill(0) },
    }))
  );
  db.seed(
    "states",
    regionIds.map((id) => ({ _id: id, countryId: "TST", population: 0 }))
  );
  db.seed(
    "macroMetrics",
    regionIds.map((id) => ({
      _id: id,
      population: {
        realizedMigrationRate: { value: 0 },
        populationGrowth: { value: 0 },
        medianAge: { value: 0 },
        sexRatio: { value: 0 },
        dependencyRatio: { value: 0 },
        demographicDecline: { value: 0 },
      },
    }))
  );
  return db;
}

function collection(db: ReturnType<typeof createInMemoryDb>, name: string) {
  return db.collection(name);
}

function metricValue(
  db: ReturnType<typeof createInMemoryDb>,
  regionId: string,
  key: keyof DemographicFlowMetricsProjection
): number {
  const doc = collection(db, "macroMetrics").docs.find((row) => row._id === regionId)!;
  const sourceKey = key === "medianAge" ? "medianAge" : key;
  return (doc.population as Record<string, { value: number }>)[sourceKey]!.value;
}

describe("demographic flow journal", () => {
  it("rejects malformed civilian loss history before publishing or writing population", async () => {
    const db = fixture();
    const result = {
      _id: "loss",
      worldEpochId: EPOCH,
      interactionId: "65a000000000000000000001",
      crisisId: "65a000000000000000000002",
      outcomeId: "escalation",
      countryId: "YU",
      stock: "civilian-residents" as const,
      appliedTurn: TURN,
      requestedPeople: 2,
      deaths: 2,
      regions: [{ regionId: "R1", deaths: 1 }],
      reason: "applied" as const,
    };
    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion()],
        stats,
        civilianLosses: [result],
      })
    ).rejects.toThrow("Invalid frozen civilian");
    expect(collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS).docs).toHaveLength(0);
    expect(collection(db, DEMOGRAPHIC_FLOW_RECEIPTS).docs).toHaveLength(0);
    expect(collection(db, "states").docs[0].population).toBe(0);
  });
  it("resumes a partial cross-collection write from the frozen region projection", async () => {
    const db = fixture();
    const states = collection(db, "states");
    const originalBulkWrite = states.bulkWrite.bind(states);
    let failOnce = true;
    states.bulkWrite = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("injected state write failure");
      }
      return originalBulkWrite(...args);
    };

    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion()],
        stats,
      })
    ).rejects.toThrow("injected state write failure");
    const stored = await loadDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN);
    expect(stored?.status).toBe("ready");
    expect(collection(db, "regionDemographics").docs[0]!.populationFlowStamp).toMatchObject({
      worldEpochId: EPOCH,
      turn: TURN,
      batchId: stored?._id,
    });
    expect(collection(db, "states").docs[0]!.populationFlowStamp).toBeUndefined();

    await expect(resumeDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN)).resolves.toEqual(
      stats
    );
    expect(collection(db, "regionDemographics").docs[0]!.ages).toEqual(makeRegion().agesAfter);
    expect(collection(db, "states").docs[0]!.population).toBe(100);
    expect(collection(db, "macroMetrics").docs[0]!.populationFlowStamp).toMatchObject({
      batchId: stored?._id,
    });
  });

  it("does not overwrite same-turn edits on targets already stamped by the batch", async () => {
    const db = fixture();
    const receipts = collection(db, DEMOGRAPHIC_FLOW_RECEIPTS);
    const originalUpdateOne = receipts.updateOne.bind(receipts);
    let failCompletion = true;
    receipts.updateOne = async (...args) => {
      const update = args[1] as { $set?: { status?: string } };
      if (failCompletion && update.$set?.status === "complete") {
        failCompletion = false;
        throw new Error("injected completion write failure");
      }
      return originalUpdateOne(...args);
    };

    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion()],
        stats,
      })
    ).rejects.toThrow("injected completion write failure");
    await collection(db, "macroMetrics").updateOne(
      { _id: "R1" },
      { $set: { "population.populationGrowth.value": 91 } }
    );

    await resumeDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN);
    expect(metricValue(db, "R1", "populationGrowth")).toBe(91);
    expect((await loadDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN))?.status).toBe(
      "complete"
    );
  });

  it("returns a complete receipt without rewriting targets or freezing a new plan", async () => {
    const db = fixture();
    const input = { worldEpochId: EPOCH, turn: TURN, regions: [makeRegion()], stats };
    await freezeAndApplyDemographicFlowPlan(db as unknown as Db, input);
    const projectionCount = collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS).docs.length;
    collection(db, "states").bulkWrite = async () => {
      throw new Error("complete receipt must not write targets");
    };

    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        ...input,
        regions: [makeRegion("R1", 999)],
        stats: { regionsProcessed: 99, circuitBreakerTrips: 8 },
      })
    ).resolves.toEqual(stats);
    expect(collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS).docs).toHaveLength(projectionCount);
  });

  it("publishes one concurrent plan and removes only the losing plan chunks", async () => {
    const db = fixture();
    const [first, second] = await Promise.all([
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion("R1", 120)],
        stats,
      }),
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion("R1", 240)],
        stats: { regionsProcessed: 7, circuitBreakerTrips: 2 },
      }),
    ]);
    expect(first).toEqual(second);
    const receipt = await loadDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN);
    expect(receipt?.status).toBe("complete");
    expect(collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS).docs).toHaveLength(0);
    expect([120, 240]).toContain(collection(db, "states").docs[0]!.population);
  });

  it("leaves an unpublished partial plan inert and allows a fresh plan to publish", async () => {
    const db = fixture({ regions: ["R1", "R2"] });
    const projections = collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS);
    const originalInsertMany = projections.insertMany.bind(projections);
    let failOnce = true;
    projections.insertMany = async (docs) => {
      if (failOnce) {
        failOnce = false;
        await originalInsertMany([docs[0]!]);
        throw new Error("injected plan chunk failure");
      }
      return originalInsertMany(docs);
    };
    const plan = [makeRegion("R1", 120), makeRegion("R2", 130)];
    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: plan,
        stats: { regionsProcessed: 2, circuitBreakerTrips: 0 },
      })
    ).rejects.toThrow("injected plan chunk failure");
    expect(await loadDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN)).toBeNull();
    expect(collection(db, "regionDemographics").docs[0]!.populationFlowStamp).toBeUndefined();
    expect(collection(db, "states").docs.every((row) => row.population === 0)).toBe(true);

    await freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
      worldEpochId: EPOCH,
      turn: TURN,
      regions: plan,
      stats: { regionsProcessed: 2, circuitBreakerTrips: 0 },
    });
    expect(await loadDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN)).toMatchObject({
      status: "complete",
      expectedRegionCount: 2,
    });
    // Only the unpublished orphan remains; completed vectors are discarded.
    expect(collection(db, DEMOGRAPHIC_FLOW_PROJECTIONS).docs).toHaveLength(1);
  });

  it("rejects stale target stamps before writing any region", async () => {
    const db = fixture({ regions: ["R1", "R2"] });
    await collection(db, "regionDemographics").updateOne(
      { _id: "R2" },
      {
        $set: {
          populationFlowStamp: { worldEpochId: EPOCH, turn: TURN + 1, batchId: "future" },
        },
      }
    );
    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion("R1"), makeRegion("R2")],
        stats: { regionsProcessed: 2, circuitBreakerTrips: 0 },
      })
    ).rejects.toThrow("Refusing stale demographic flow receipt");
    expect(collection(db, "regionDemographics").docs[0]!.populationFlowStamp).toBeUndefined();
    expect(collection(db, "states").docs.every((row) => row.population === 0)).toBe(true);
  });

  it("validates the current epoch for both new plans and receipt replay", async () => {
    const db = fixture();
    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: "wrong-epoch",
        turn: TURN,
        regions: [makeRegion()],
        stats,
      })
    ).rejects.toThrow("different or missing world epoch");
    await freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
      worldEpochId: EPOCH,
      turn: TURN,
      regions: [makeRegion()],
      stats,
    });
    await collection(db, "gameState").updateOne(
      { _id: "current" },
      { $set: { worldEpochId: "new-reset-epoch" } }
    );
    await expect(resumeDemographicFlowReceipt(db as unknown as Db, EPOCH, TURN)).rejects.toThrow(
      "different or missing world epoch"
    );
  });

  it("fails closed on missing target documents and enumerates pending receipts by turn", async () => {
    const db = fixture({ regions: ["R1", "R2"] });
    await collection(db, "states").deleteOne({ _id: "R2" });
    await expect(
      freezeAndApplyDemographicFlowPlan(db as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion("R1"), makeRegion("R2")],
        stats: { regionsProcessed: 2, circuitBreakerTrips: 0 },
      })
    ).rejects.toThrow("Missing states target for region R2");
    expect(collection(db, "regionDemographics").docs.every((row) => !row.populationFlowStamp)).toBe(
      true
    );

    const other = fixture({ regions: ["R1"] });
    const originalStateBulk = collection(other, "states").bulkWrite.bind(
      collection(other, "states")
    );
    let failOnce = true;
    collection(other, "states").bulkWrite = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("leave receipt pending");
      }
      return originalStateBulk(...args);
    };
    await expect(
      freezeAndApplyDemographicFlowPlan(other as unknown as Db, {
        worldEpochId: EPOCH,
        turn: TURN,
        regions: [makeRegion()],
        stats,
      })
    ).rejects.toThrow("leave receipt pending");
    await expect(
      resumePendingDemographicFlowReceipts(other as unknown as Db, EPOCH, TURN)
    ).resolves.toEqual([stats]);
  });
});
