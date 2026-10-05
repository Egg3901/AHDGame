import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  freezeAndApplyDemographicFlowPlan,
  type DemographicFlowRegionProjection,
} from "./flowJournal";

// These tests inspect demographic formulas in the frozen plan. Journal tests
// and the real-Mongo replay harness cover durable materialization separately.
vi.mock("./worldEpoch", () => ({
  ensureDemographicWorldEpoch: vi.fn(async () => "formula-test-world"),
}));
vi.mock("./flowJournal", () => ({
  resumeDemographicFlowReceipt: vi.fn(async () => null),
  freezeAndApplyDemographicFlowPlan: vi.fn(
    async (_db: Db, plan: Parameters<typeof freezeAndApplyDemographicFlowPlan>[1]) => plan.stats
  ),
}));

function plannedRegions(db: MockDb): DemographicFlowRegionProjection[] {
  const calls = vi.mocked(freezeAndApplyDemographicFlowPlan).mock.calls;
  const call = calls.findLast(([target]) => target === (db as unknown as Db));
  return call?.[1].regions ?? [];
}

function projectionWrites(
  db: MockDb,
  collection: "states" | "macroMetrics" | "regionDemographics"
) {
  return plannedRegions(db).map((region) => {
    const fields =
      collection === "states"
        ? region.stateAfter
        : collection === "regionDemographics"
          ? { ages: region.agesAfter }
          : Object.fromEntries(
              Object.entries(region.metricsAfter).map(([key, value]) => [
                `population.${key}.value`,
                value,
              ])
            );
    return { updateOne: { filter: { _id: region.regionId }, update: { $set: fields } } };
  });
}
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

function vec(pop: number) {
  // simple vector summing to `pop`: spread across working ages 20-59 (40 ages),
  // split 50/50 → 40 ages × 2 sexes = 80 cells, each pop/80.
  const male = Array.from({ length: 101 }, (_, a) => (a >= 20 && a < 60 ? pop / 80 : 0));
  const female = male.slice();
  return { male, female };
}

function youngVec() {
  const male = Array<number>(101).fill(0);
  const female = Array<number>(101).fill(0);
  for (const age of [16, 17, 30]) {
    male[age] = 100_000;
    female[age] = 100_000;
  }
  return { male, female };
}

describe("runDemographicFlows", () => {
  let db: MockDb;

  function setDemos(docs: Array<{ _id: string; countryId: string; ages: ReturnType<typeof vec> }>) {
    db.collection("regionDemographics");
    db.collectionMocks.regionDemographics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(docs),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    setDemos([{ _id: "CA", countryId: "US", ages: vec(1_000_000) }]);

    db.collection("states");
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", countryId: "US", population: 1_000_000 }]),
    });

    db.collection("stateMetrics");
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "CA",
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
            healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
          },
        ]),
      }),
    });
  });

  it("advances the vector and writes population SSOT + metrics + the vector", async () => {
    const { runDemographicFlows } = await import("./phase");
    const result = await runDemographicFlows(db as unknown as Db, 1);
    expect(result.regionsProcessed).toBe(1);
    const [region] = plannedRegions(db);
    expect(region.agesAfter.male).toHaveLength(101);
    expect(region.stateAfter.population).toBeGreaterThan(0);
    expect(region.metricsAfter).toHaveProperty("populationGrowth");
    expect(plannedRegions(db)[0]!.resetCohortReadingAfter).toBeUndefined();
  });

  it("writes raw realized cohort outcomes only for a seed-verified v2 world", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 1,
      resetWorldId: "test-reset-world",
      metricsSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: {
          worldId: "test-reset-world",
          revision: RESET_V2_SEED_REVISION.metrics,
          sourceTurn: 1,
          completedAt: "2026-09-30T00:00:00.000Z",
          verificationHash: "verified",
        },
      },
    });
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US:CA",
          worldId: "test-reset-world",
          countryId: "US",
          regionId: "CA",
          asOfTurn: 1,
          observations: { "19": { value: 250 } },
        },
      ]),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 2, {
      metrics: true,
      legislation: false,
      cabinet: false,
    });
    expect(plannedRegions(db)[0]!.resetCohortReadingAfter).toMatchObject({
      asOfTurn: 2,
      realizedTfr: expect.any(Number),
      dependencyBurden15To64: expect.any(Number),
      populationGrowthAnnualized: expect.any(Number),
      periodLifeExpectancy: expect.any(Number),
    });
    expect(db.collectionMocks.resetMetricSnapshots!.find).toHaveBeenCalledWith(
      expect.objectContaining({ worldId: "test-reset-world", scope: "regional" }),
      expect.objectContaining({
        projection: expect.objectContaining({ "observations.19.value": 1 }),
      })
    );
  });

  it("refuses stale or missing v2 health ownership rather than reverting to political inputs", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 1,
      resetWorldId: "test-reset-world",
      metricsSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: {
          worldId: "test-reset-world",
          revision: RESET_V2_SEED_REVISION.metrics,
          sourceTurn: 1,
          completedAt: "2026-09-30T00:00:00.000Z",
          verificationHash: "verified",
        },
      },
    });
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const { runDemographicFlows } = await import("./phase");
    await expect(
      runDemographicFlows(db as unknown as Db, 2, {
        metrics: true,
        legislation: false,
        cabinet: false,
      })
    ).rejects.toThrow("V2 cohorts lack current health inputs");
    expect(plannedRegions(db)).toEqual([]);
  });

  it("writes a population SSOT equal to the Σ of the advanced vector", async () => {
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const call = projectionWrites(db, "states") as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { population: number } } };
    }>;
    expect(call[0].updateOne.update.$set.population).toBeGreaterThan(0);
  });

  it("clamps surfaced populationGrowth to its bound while the stock uses the un-clamped flow, and never overwrites the policy migrationRate", async () => {
    // A huge migrationRate input (50%/yr) drives a large real population gain. The
    // surfaced populationGrowth must saturate at its [-3,5] bound (audit-7), but
    // the stock grows by the un-clamped flow, and migrationRate (the policy INPUT)
    // is left untouched so the policy signal does not erode.
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "CA",
            population: { birthRate: { value: 50 }, migrationRate: { value: 50 } },
            healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
          },
        ]),
      }),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const set = (
      projectionWrites(db, "macroMetrics") as Array<{
        updateOne: { update: { $set: Record<string, number> } };
      }>
    )[0].updateOne.update.$set;
    expect(set["population.populationGrowth.value"]).toBeLessThanOrEqual(5); // saturates bound
    expect(set).not.toHaveProperty("population.migrationRate.value"); // policy input untouched
    const stateCall = projectionWrites(db, "states") as Array<{
      updateOne: { update: { $set: { population: number } } };
    }>;
    // un-clamped flow still grew the real stock past a +5%/yr-capped level
    expect(stateCall[0].updateOne.update.$set.population).toBeGreaterThan(1_000_000);
  });

  it("writes the realized migrationRate readout (§8.2) without overwriting the policy migrationRate", async () => {
    // migrationRate input 50 (%/yr) drives a large realized inflow. The realized
    // rate is surfaced as a SEPARATE readout, while the policy input is untouched.
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "CA",
            population: { birthRate: { value: 50 }, migrationRate: { value: 50 } },
            healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
          },
        ]),
      }),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const set = (
      projectionWrites(db, "macroMetrics") as Array<{
        updateOne: { update: { $set: Record<string, number> } };
      }>
    )[0].updateOne.update.$set;
    expect(set["population.realizedMigrationRate.value"]).toBeGreaterThan(0); // realized inflow surfaced
    expect(set).not.toHaveProperty("population.migrationRate.value"); // policy input untouched
  });

  it("turns a persistent labour shortage into additional population growth", async () => {
    async function runMode(labourSystemMode: "wages" | "macro") {
      const target = createMockDb();
      target.collection("regionDemographics");
      target.collectionMocks.regionDemographics!.find = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: "CA", countryId: "US", ages: vec(1_000_000) }]),
      });
      target.collection("states");
      target.collectionMocks.states!.find = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: "CA", countryId: "US", population: 1_000_000 }]),
      });
      target.collection("stateMetrics");
      target.collectionMocks.macroMetrics = target.collectionMocks.stateMetrics!;
      target.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: "CA",
              population: { birthRate: { value: 50 }, migrationRate: { value: 0.05 } },
              healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
              economic: {
                labourTightness: { value: 4.8 },
                labourWageIndex: { value: 1 },
              },
            },
          ]),
        }),
      });
      target.collection("gameConfig");
      target.collectionMocks.gameConfig!.findOne = vi
        .fn()
        .mockResolvedValue({ _id: "default", labourSystemMode });

      const { runDemographicFlows } = await import("./phase");
      await runDemographicFlows(target as unknown as Db, 1);
      const population = (
        projectionWrites(target, "states") as Array<{
          updateOne: { update: { $set: { population: number } } };
        }>
      )[0].updateOne.update.$set.population;
      const metrics = (
        projectionWrites(target, "macroMetrics") as Array<{
          updateOne: { update: { $set: Record<string, number> } };
        }>
      )[0].updateOne.update.$set;
      return { population, realizedMigration: metrics["population.realizedMigrationRate.value"] };
    }

    const gated = await runMode("wages");
    const responsive = await runMode("macro");

    expect(responsive.realizedMigration).toBeGreaterThan(gated.realizedMigration);
    expect(responsive.population).toBeGreaterThan(gated.population);
  });

  it("writes state.votingEligiblePopulation (Σ ages ≥ voting age) ≤ total population", async () => {
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const set = (
      projectionWrites(db, "states") as Array<{
        updateOne: { update: { $set: { population: number; votingEligiblePopulation: number } } };
      }>
    )[0].updateOne.update.$set;
    expect(set.votingEligiblePopulation).toBeGreaterThan(0);
    expect(set.votingEligiblePopulation).toBeLessThanOrEqual(set.population);
  });

  it("applies each country's enacted voting age without changing another country", async () => {
    setDemos([
      { _id: "BEO", countryId: "DD", ages: youngVec() },
      { _id: "CA", countryId: "US", ages: youngVec() },
    ]);
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "BEO", countryId: "DD", population: 600_000 },
        { _id: "CA", countryId: "US", population: 600_000 },
      ]),
    });
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "BEO", population: { birthRate: { value: 50 }, migrationRate: { value: 0 } } },
          { _id: "CA", population: { birthRate: { value: 50 }, migrationRate: { value: 0 } } },
        ]),
      }),
    });
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      currentYear: 1953,
      startingYear: 1953,
      currentTurn: 1,
      votingAgeEligibleByCountry: { DD: 16 },
    });

    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const writes = projectionWrites(db, "states") as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { votingEligiblePopulation: number } };
      };
    }>;
    const eligible = (id: string) =>
      writes.find((write) => write.updateOne.filter._id === id)!.updateOne.update.$set
        .votingEligiblePopulation;

    expect(eligible("BEO")).toBeGreaterThan(eligible("CA"));
  });

  it("writes state.workingAgePopulation (Σ ages [18,64)) ≤ votingEligiblePopulation", async () => {
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const set = (
      projectionWrites(db, "states") as Array<{
        updateOne: {
          update: { $set: { workingAgePopulation: number; votingEligiblePopulation: number } };
        };
      }>
    )[0].updateOne.update.$set;
    expect(set.workingAgePopulation).toBeGreaterThan(0);
    expect(set.workingAgePopulation).toBeLessThanOrEqual(set.votingEligiblePopulation);
  });

  it("internal migration conserves the country's national total and favors the attractive region", async () => {
    db.collection("regionDemographics");
    db.collectionMocks.regionDemographics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", countryId: "US", ages: vec(1_000_000) },
        { _id: "TX", countryId: "US", ages: vec(1_000_000) },
      ]),
    });
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", countryId: "US", population: 1_000_000 },
        { _id: "TX", countryId: "US", population: 1_000_000 },
      ]),
    });
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "CA",
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
            healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
            economic: {
              gdpGrowth: { value: 6 },
              unemploymentRate: { value: 3 },
              medianIncome: { value: 60000 },
              costOfLiving: { value: 45 },
            },
          },
          {
            _id: "TX",
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
            healthcare: { lifeExpectancy: { value: 50 }, preventableMortality: { value: 50 } },
            economic: {
              gdpGrowth: { value: 0 },
              unemploymentRate: { value: 9 },
              medianIncome: { value: 40000 },
              costOfLiving: { value: 55 },
            },
          },
        ]),
      }),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const writes = projectionWrites(db, "states") as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { population: number } } };
    }>;
    const nationalAfter = writes.reduce((s, w) => s + w.updateOne.update.$set.population, 0);
    expect(nationalAfter).toBeGreaterThan(1_900_000); // conserved (within rounding)
    expect(nationalAfter).toBeLessThan(2_100_000);
    const caPop = writes.find((w) => w.updateOne.filter._id === "CA")!.updateOne.update.$set
      .population;
    const txPop = writes.find((w) => w.updateOne.filter._id === "TX")!.updateOne.update.$set
      .population;
    expect(caPop).toBeGreaterThan(txPop); // internal migration favored the attractive region
    const metricWrites = projectionWrites(db, "macroMetrics") as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: Record<string, number> };
      };
    }>;
    const caMigration = metricWrites.find((w) => w.updateOne.filter._id === "CA")!.updateOne.update
      .$set["population.realizedMigrationRate.value"];
    const txMigration = metricWrites.find((w) => w.updateOne.filter._id === "TX")!.updateOne.update
      .$set["population.realizedMigrationRate.value"];
    expect(caMigration).toBeGreaterThan(0);
    expect(txMigration).toBeLessThan(0);
  });

  it("moves matched EU migrants between real regional cohorts without creating people", async () => {
    setDemos([
      { _id: "PL_A", countryId: "PL", ages: vec(1_000_000) },
      { _id: "DE_A", countryId: "DE", ages: vec(1_000_000) },
    ]);
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "PL_A", countryId: "PL", population: 1_000_000 },
        { _id: "DE_A", countryId: "DE", population: 1_000_000 },
      ]),
    });
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "PL_A", population: { birthRate: { value: 50 }, migrationRate: { value: -1.5 } } },
          { _id: "DE_A", population: { birthRate: { value: 50 }, migrationRate: { value: 1.5 } } },
        ]),
      }),
    });
    db.collection("organizationMemberships");
    const memberships = db.collectionMocks.organizationMemberships!;
    memberships.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { countryId: "PL", status: "active" },
        { countryId: "DE", status: "active" },
      ]),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const liveWrites = projectionWrites(db, "states") as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { population: number } } };
    }>;
    const live = Object.fromEntries(
      liveWrites.map((op) => [op.updateOne.filter._id, op.updateOne.update.$set.population])
    );
    expect(memberships.find).toHaveBeenCalledWith({ organizationId: "EU" }, expect.anything());

    vi.mocked(freezeAndApplyDemographicFlowPlan).mockClear();
    memberships.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    await runDemographicFlows(db as unknown as Db, 1);
    const closedWrites = projectionWrites(db, "states") as typeof liveWrites;
    const closed = Object.fromEntries(
      closedWrites.map((op) => [op.updateOne.filter._id, op.updateOne.update.$set.population])
    );
    expect(live.PL_A).toBeCloseTo(closed.PL_A, 3);
    expect(live.DE_A).toBeGreaterThan(closed.DE_A);
    expect(live.PL_A + live.DE_A).toBeGreaterThan(closed.PL_A + closed.DE_A);
  });

  it("moves working-age population toward a state with persistent unfilled jobs", async () => {
    setDemos([
      { _id: "CA", countryId: "US", ages: vec(1_000_000) },
      { _id: "TX", countryId: "US", ages: vec(1_000_000) },
    ]);
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", countryId: "US", population: 1_000_000 },
        { _id: "TX", countryId: "US", population: 1_000_000 },
      ]),
    });
    const neutralEconomy = {
      gdpGrowth: { value: 2.5 },
      unemploymentRate: { value: 5 },
      medianIncome: { value: 50_000 },
      costOfLiving: { value: 50 },
      labourWageIndex: { value: 1 },
    };
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "CA",
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
            economic: { ...neutralEconomy, labourTightness: { value: 4.8 } },
          },
          {
            _id: "TX",
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
            economic: { ...neutralEconomy, labourTightness: { value: 0.8 } },
          },
        ]),
      }),
    });
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", labourSystemMode: "macro" });

    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const writes = projectionWrites(db, "states") as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { population: number } } };
    }>;
    const caPopulation = writes.find((write) => write.updateOne.filter._id === "CA")!.updateOne
      .update.$set.population;
    const txPopulation = writes.find((write) => write.updateOne.filter._id === "TX")!.updateOne
      .update.$set.population;

    expect(caPopulation).toBeGreaterThan(txPopulation);
  });

  it("writes state.militaryServicePopulation (conscription withdrawal) for a conscripting country", async () => {
    setDemos([{ _id: "BJ", countryId: "CN", ages: vec(1_000_000) }]);
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "BJ", countryId: "CN", population: 1_000_000 }]),
    });
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    const set = (
      projectionWrites(db, "states") as Array<{
        updateOne: { update: { $set: { militaryServicePopulation: number } } };
      }>
    )[0].updateOne.update.$set;
    expect(set.militaryServicePopulation).toBeGreaterThan(0); // CN seeds a draft rung (option 6)
  });

  it("does NOT mutate the electoral stateDemographics snapshot (B2/F-5) — P1d-1", async () => {
    // The cohort flows evolve the SSOT stock (regionDemographics + state.population
    // + stateMetrics), but the electoral demographic SHARES (`stateDemographics`)
    // stay a B2 snapshot until a census event (§6.2). The phase must never touch
    // that collection — pin it so a future change can't silently leak the live
    // cohort into vote distribution pre-census.
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    expect(db.collectionMocks.stateDemographics).toBeUndefined();
  });

  it("skips national-scope synthetic docs", async () => {
    setDemos([{ _id: "federal", countryId: "US", ages: vec(1) }]);
    const { runDemographicFlows } = await import("./phase");
    expect((await runDemographicFlows(db as unknown as Db, 1)).regionsProcessed).toBe(0);
  });
});

describe("Bridge A — political inputs drive the cohort engine", () => {
  /**
   * One playable-shaped region: population.* present on macroMetrics (survivor
   * categories), healthcare.* ABSENT — which is the real post-SP5 shape, since
   * playable regions have no stateMetrics doc at all.
   */
  function makeDb(regionId: string, countryId: string, values: Record<string, number> | null) {
    const db = createMockDb();
    db.collection("regionDemographics");
    db.collectionMocks.regionDemographics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: regionId, countryId, ages: vec(1_000_000) }]),
    });

    db.collection("states");
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: regionId, countryId, population: 1_000_000 }]),
    });

    db.collection("stateMetrics");
    db.collectionMocks.macroMetrics = db.collectionMocks.stateMetrics!;
    db.collectionMocks.stateMetrics!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: regionId,
            population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
          },
        ]),
      }),
    });

    db.collection("politicalMetrics");
    db.collectionMocks.politicalMetrics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(values ? [{ _id: regionId, countryId, values }] : []),
    });
    return db;
  }

  /** Σ population written to `states` after one turn. */
  function populationWritten(db: MockDb): number {
    const ops = projectionWrites(db, "states") as Array<{
      updateOne: { update: { $set: { population: number } } };
    }>;
    return ops.reduce((sum, op) => sum + op.updateOne.update.$set.population, 0);
  }

  async function runWith(values: Record<string, number> | null, countryId = "US") {
    const db = makeDb("MA", countryId, values);
    const { runDemographicFlows } = await import("./phase");
    await runDemographicFlows(db as unknown as Db, 1);
    return populationWritten(db);
  }

  it("a strong health board leaves more people alive than a weak one", async () => {
    const strong = await runWith({ "health.outcomes": 95, "health.prevention": 95 });
    const weak = await runWith({ "health.outcomes": 5, "health.prevention": 5 });
    expect(strong).toBeGreaterThan(weak);
  });

  it("the political neutral reproduces the pre-bridge constants exactly", async () => {
    // Parity property: a region at 50 must behave as if the board were absent,
    // because 50 maps to the same mid the engine already defaults to.
    const atNeutral = await runWith({ "health.outcomes": 50, "health.prevention": 50 });
    const noBoard = await runWith(null);
    expect(atNeutral).toBeCloseTo(noBoard, 6);
  });

  it("leaves a non-playable region untouched", async () => {
    const jp = await runWith(null, "JP");
    expect(jp).toBeGreaterThan(0);
  });

  it("a strong society.demography board raises births", async () => {
    const high = await runWith({ "society.demography": 95 });
    const low = await runWith({ "society.demography": 5 });
    expect(high).toBeGreaterThan(low);
  });
});
