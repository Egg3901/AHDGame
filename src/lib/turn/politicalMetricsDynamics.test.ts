import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { lawTargets } from "@/lib/politicalLegislation/dynamics";
import { processPoliticalMetricsDynamics } from "./politicalMetricsDynamics";
import { TIER2_SOURCES } from "@/lib/politicalMetrics/macroFamilySources";
import { ENGINE_PATHS_BY_FAMILY } from "@/lib/politicalMetrics/engineTerm";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Off by default (the provider is a no-op below labour "full" mode), so every
// existing fixture is unaffected; the labourResiduals test drives it directly.
vi.mock("@/lib/unions/labourRelationsPoliticalProvider", () => ({
  loadLabourRelationsPoliticalNudgesByCountry: vi.fn().mockResolvedValue(new Map()),
}));

function baselineLevels(countryId: "US" | "UK" | "RU") {
  return new Map(
    getCatalog(countryId)
      .filter((l) => l.kind !== "tax")
      .map((l) => [l.id, l.baselineLevel ?? 0])
  );
}

/**
 * A chainable find() cursor. The overrides below must support `.project()`
 * because the phase now also runs the metric engine's provider reads (spending,
 * approval, sector mix) to evaluate the political nodes — a bare `{ toArray }`
 * stub throws the moment a provider projects.
 */
function cursorOf(rows: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn(() => cursor),
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
  };
  return cursor;
}

/** Residuals that put a doc exactly at equilibrium for the given values. */
function equilibriumResiduals(countryId: "US" | "UK" | "RU", values: Record<string, number>) {
  const national = lawTargets(countryId, baselineLevels(countryId));
  const residuals: Record<string, number> = {};
  for (const [metricId, points] of Object.entries(national)) {
    residuals[metricId] = (values[metricId] ?? 0) - points;
  }
  return residuals;
}

/** Full-coverage values map (every family) at a flat score. */
function flatValues(score: number) {
  const values: Record<string, number> = {};
  for (const law of getCatalog("UK")) {
    if (law.kind === "tax") continue;
    for (const t of law.targets) values[t.metricId] = score;
  }
  return values;
}

describe("processPoliticalMetricsDynamics", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "politicalMetrics",
      "statePolicies",
      "states",
      "politicalMetricsHistory",
      "politicalCabinetContribution",
      "macroMetrics",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue(null);
  });

  function wire({
    metricsDocs,
    nationalPolicies = [],
    regionalPolicies = [],
    macroDocs = [],
  }: {
    metricsDocs: unknown[];
    nationalPolicies?: unknown[];
    regionalPolicies?: unknown[];
    macroDocs?: unknown[];
  }) {
    db.collectionMocks.macroMetrics.find = vi
      .fn()
      .mockImplementation((filter?: { countryId?: string }) =>
        cursorOf(
          (macroDocs as Array<{ countryId?: string }>).filter(
            (d) => d.countryId === filter?.countryId
          )
        )
      );
    // The phase derives its country list from the collection, so a fixture
    // without `distinct` would process nothing at all.
    db.collectionMocks.politicalMetrics.distinct = vi
      .fn()
      .mockResolvedValue([
        ...new Set((metricsDocs as Array<{ countryId?: string }>).map((d) => d.countryId)),
      ]);
    db.collectionMocks.politicalMetrics.find = vi
      .fn()
      .mockImplementation((filter?: { countryId?: string }) =>
        cursorOf(
          (metricsDocs as Array<{ countryId?: string }>).filter(
            (d) => d.countryId === filter?.countryId
          )
        )
      );
    db.collectionMocks.statePolicies.find = vi
      .fn()
      .mockImplementation((filter?: { scope?: string }) =>
        cursorOf(filter?.scope === "state" ? regionalPolicies : nationalPolicies)
      );
    db.collectionMocks.states.find = vi
      .fn()
      .mockImplementation(() => cursorOf([{ _id: "R1", countryId: "UK", population: 1_000_000 }]));
  }

  /** The flat-UK baseline: same fixture, no regional supplement. */
  async function runFlatUk(): Promise<Record<string, number>> {
    const values = flatValues(50);
    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
      ],
      nationalPolicies: getCatalog("UK")
        .filter((l) => l.kind !== "tax")
        .map((l) => ({ legislationTypeId: l.id, policyOptionIndex: l.baselineLevel ?? 0 })),
    });
    // The caller may already have driven a run; without this the assertion
    // would read that earlier call back and compare a value with itself.
    db.collectionMocks.politicalMetrics.bulkWrite.mockClear();
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: { update: { $set: { values: Record<string, number> } } };
    }>;
    return ops[0].updateOne.update.$set.values;
  }

  it("drifts a displaced region toward its target via one bulkWrite per country", async () => {
    const values = flatValues(50);
    const residuals = equilibriumResiduals("UK", values);
    // Displace one metric 10 below equilibrium.
    const displaced = { ...values, "health.universalCare": 40 };
    wire({
      metricsDocs: [{ _id: "R1", countryId: "UK", values: displaced, residuals }],
      nationalPolicies: getCatalog("UK")
        .filter((l) => l.kind !== "tax")
        .map((l) => ({
          legislationTypeId: l.id,
          policyOptionIndex: l.baselineLevel ?? 0,
        })),
    });
    const result = await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    expect(result.regionsDrifted).toBeGreaterThanOrEqual(1);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: { update: { $set: { values: Record<string, number> } } };
    }>;
    const next = ops[0].updateOne.update.$set.values;
    // Directional, not the old exact 40.05. The composed target now carries the
    // bounded ENGINE term as well as the law ladder, and this fixture seeds no
    // budgets — a country funding nothing, which the causal model reads as poor
    // services and which legitimately moves the target. `driftStep`'s exact
    // arithmetic is pinned in dynamics.test.ts; what belongs here is that the
    // displaced family moves and the whole board is driven in one write.
    expect(next["health.universalCare"]).not.toBe(40);
    expect(Math.abs(next["health.universalCare"] - 40)).toBeLessThan(1);
  });

  it("holds families the causal model has no opinion about exactly still", async () => {
    // Was "docs already at equilibrium produce no writes". Sitting at the LAW
    // equilibrium is no longer the same as sitting at rest: the composed target
    // also carries the bounded engine term, so a family the engine models does
    // move even from its law equilibrium — that IS the channel working.
    // What must still hold is the converse: a family with NO engine node behind
    // it has nothing to bend it, so law equilibrium is still true equilibrium.
    const next = await runFlatUk();
    const unmodelled = Object.keys(next).filter((id) => !(id in ENGINE_PATHS_BY_FAMILY));
    expect(unmodelled.length).toBeGreaterThan(0);
    for (const id of unmodelled) expect(next[id]).toBe(50);
  });

  it("a regional L4 primary raises that region's target by 25 (half of 50)", async () => {
    const values = flatValues(50);
    const residuals = equilibriumResiduals("UK", values);
    wire({
      metricsDocs: [{ _id: "R1", countryId: "UK", values, residuals }],
      nationalPolicies: getCatalog("UK")
        .filter((l) => l.kind !== "tax")
        .map((l) => ({ legislationTypeId: l.id, policyOptionIndex: l.baselineLevel ?? 0 })),
      regionalPolicies: [
        {
          stateId: "R1",
          legislationTypeId: "uk.health.universalCare.primary",
          policyOptionIndex: 4,
        },
      ],
    });
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: { update: { $set: { values: Record<string, number> } } };
    }>;
    const next = ops[0].updateOne.update.$set.values;
    // The regional supplement must RAISE this family's target relative to the
    // same fixture without it. Asserted as a comparison rather than the old
    // exact 50.125 because the composed target now also carries the engine
    // term, which is identical across the two runs and therefore cancels.
    const withoutSupplement = await runFlatUk();
    expect(next["health.universalCare"]).toBeGreaterThan(withoutSupplement["health.universalCare"]);
  });

  it("lazily self-heals missing residuals and does not drift that turn", async () => {
    const values = flatValues(63.4);
    wire({
      metricsDocs: [{ _id: "R1", countryId: "UK", values }], // no residuals
      nationalPolicies: getCatalog("UK")
        .filter((l) => l.kind !== "tax")
        .map((l) => ({ legislationTypeId: l.id, policyOptionIndex: l.baselineLevel ?? 0 })),
    });
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: {
        update: { $set: { values: Record<string, number>; residuals: Record<string, number> } };
      };
    }>;
    const set = ops[0].updateOne.update.$set;
    expect(set.residuals).toBeDefined();
    // Healed to current-value equilibrium → values unchanged this turn.
    expect(set.values["health.universalCare"]).toBe(63.4);
    const national = lawTargets("UK", baselineLevels("UK"));
    expect(set.residuals["health.universalCare"]).toBeCloseTo(
      63.4 - national["health.universalCare"],
      9
    );
  });

  it("drives NON-PLAYABLE boards too, not just the four with a law catalog", async () => {
    // The step-6 cutover pointed every board country's consumers at the board.
    // The dynamics phase used to iterate LAW_COUNTRY_IDS, so a non-playable's
    // board was written once at seed and then frozen forever — its approval,
    // corp margins and crisis triggers could never move again.
    const values = flatValues(50);
    wire({
      metricsDocs: [
        { _id: "KAN", countryId: "JP", values },
        { _id: "BY", countryId: "DE", values },
      ],
    });
    const result = await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    expect(result.countriesProcessed).toBe(2);
    expect(db.collectionMocks.politicalMetrics.bulkWrite).toHaveBeenCalled();
  });

  it("adopts a non-playable's seeded values as equilibrium — no cutover lurch", async () => {
    // A country with no new-generation catalog composes a ZERO law target, so
    // the self-heal must record residual = value. If getCatalog returned
    // undefined the phase would throw; if the residual were wrong the whole
    // board would drift toward 0 on the first turn after deploy.
    const values = flatValues(50);
    wire({ metricsDocs: [{ _id: "KAN", countryId: "JP", values }] });
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        update: { $set: { values: Record<string, number>; residuals: Record<string, number> } };
      };
    }>;
    const set = ops[0].updateOne.update.$set;
    expect(set.residuals["health.universalCare"]).toBeCloseTo(50, 9);
    // Healed turn drifts nothing.
    expect(set.values["health.universalCare"]).toBeCloseTo(50, 9);
  });

  it("no-ops for worlds without politicalMetrics docs", async () => {
    wire({ metricsDocs: [] });
    const result = await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    expect(result.countriesProcessed).toBe(0);
    expect(db.collectionMocks.politicalMetrics.bulkWrite).not.toHaveBeenCalled();
  });

  it("never touches stateMetrics (isolation regression)", async () => {
    const values = flatValues(50);
    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
      ],
    });
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const touched = (db.collection as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(touched).not.toContain("stateMetrics");
  });

  // Sitting at the LAW equilibrium is no longer the same as sitting at rest: the
  // composed target also carries the bounded macro and engine terms, so a family
  // the engine models moves from law equilibrium on its own. To assert anything
  // about the CABINET channel these tests isolate it on a family the engine has
  // no opinion about — there, law equilibrium is still true equilibrium, so any
  // movement is the cabinet channel and nothing else.
  const unmodelledFamilies = (values: Record<string, number>) =>
    Object.keys(values).filter((id) => !(id in ENGINE_PATHS_BY_FAMILY));

  it("folds a cabinet contribution into cabinetResiduals and drifts toward it", async () => {
    const values = flatValues(50);
    const family = unmodelledFamilies(values)[0];
    expect(family).toBeTruthy();

    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
      ],
    });
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      contribution: { [family]: 5 },
      turn: 4,
    });

    const result = await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    expect(result.regionsDrifted).toBeGreaterThanOrEqual(1);
    const op = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0] as {
      updateOne: {
        update: {
          $set: { values: Record<string, number>; cabinetResiduals: Record<string, number> };
        };
      };
    };
    // Contribution seeded into cabinetResiduals…
    expect(op.updateOne.update.$set.cabinetResiduals[family]).toBeCloseTo(5, 5);
    // …and the value drifts UP toward the cabinet-lifted target (was 50).
    expect(op.updateOne.update.$set.values[family]).toBeGreaterThan(50);
  });

  /**
   * Ticket #1129 balance pass. A player built estates and nothing happened: the
   * whole cabinet channel shared ONE cap, and on prod the standing tier settings
   * had already filled it. The cap is now per channel, so the estate lands in
   * its own channel and buys movement.
   */
  it("an estate still contributes when another cabinet channel is saturated", async () => {
    const values = flatValues(50);
    const family = unmodelledFamilies(values)[0];
    expect(family).toBeTruthy();

    wire({
      metricsDocs: [
        {
          _id: "R1",
          countryId: "UK",
          values,
          residuals: equilibriumResiduals("UK", values),
          cabinetResiduals: { [family]: 8 },
          cabinetResidualsBySource: { settings: { [family]: 8 } },
        },
      ],
    });
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      contribution: { [family]: 5 },
      regional: { R1: { [family]: 2 } },
      sources: {
        settings: { contribution: { [family]: 5 }, regional: {} },
        estates: { contribution: {}, regional: { R1: { [family]: 2 } } },
      },
      turn: 4,
    });

    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const op = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0] as {
      updateOne: {
        update: {
          $set: {
            values: Record<string, number>;
            cabinetResiduals: Record<string, number>;
            cabinetResidualsBySource: Record<string, Record<string, number>>;
          };
        };
      };
    };
    const set = op.updateOne.update.$set;
    // The settings channel stays pinned at its own cap and absorbs nothing more.
    expect(set.cabinetResidualsBySource.settings[family]).toBe(8);
    // The estate contributes in full, on top, which the old single cap forbade.
    expect(set.cabinetResidualsBySource.estates[family]).toBeCloseTo(2, 5);
    expect(set.cabinetResiduals[family]).toBeCloseTo(10, 5);
    expect(set.values[family]).toBeGreaterThan(50);
  });

  it("applies a regional cabinet extra only to the sited region (ticket #1129)", async () => {
    const values = flatValues(50);
    const family = unmodelledFamilies(values)[0];
    expect(family).toBeTruthy();

    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
        {
          _id: "R2",
          countryId: "UK",
          values: { ...values },
          residuals: equilibriumResiduals("UK", values),
        },
      ],
    });
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      contribution: {},
      regional: { R1: { [family]: 5 } },
      turn: 4,
    });

    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: {
          $set: { values: Record<string, number>; cabinetResiduals?: Record<string, number> };
        };
      };
    }>;
    const r1 = ops.find((op) => op.updateOne.filter._id === "R1");
    const r2 = ops.find((op) => op.updateOne.filter._id === "R2");
    expect(r1?.updateOne.update.$set.cabinetResiduals?.[family!]).toBeCloseTo(5, 5);
    expect(r1?.updateOne.update.$set.values[family!]).toBeGreaterThan(50);
    // R2 has no extra: either unwritten (nothing moved) or written without that residual.
    expect(r2?.updateOne.update.$set.cabinetResiduals?.[family!] ?? 0).toBe(0);
    if (r2?.updateOne.update.$set.values) {
      expect(r2.updateOne.update.$set.values[family!]).toBe(50);
    }
  });

  it("persists the labour term to labourResiduals so the strike channel is traceable", async () => {
    const { loadLabourRelationsPoliticalNudgesByCountry } =
      await import("@/lib/unions/labourRelationsPoliticalProvider");
    const values = flatValues(50);
    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
      ],
    });
    vi.mocked(loadLabourRelationsPoliticalNudgesByCountry).mockResolvedValueOnce(
      new Map([["UK", new Map([["economy.workerSecurity", -2.25]])]]) as Awaited<
        ReturnType<typeof loadLabourRelationsPoliticalNudgesByCountry>
      >
    );

    await processPoliticalMetricsDynamics(db as unknown as Db, 5);

    const op = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0] as {
      updateOne: { update: { $set: { labourResiduals?: Record<string, number> } } };
    };
    expect(op.updateOne.update.$set.labourResiduals).toEqual({
      "economy.workerSecurity": -2.25,
    });
  });

  it("writes no labourResiduals when the labour channel is silent (regression)", async () => {
    const values = flatValues(50);
    wire({
      metricsDocs: [
        {
          _id: "R1",
          countryId: "UK",
          values,
          residuals: equilibriumResiduals("UK", values),
        },
      ],
    });

    await processPoliticalMetricsDynamics(db as unknown as Db, 5);

    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as
      Array<{ updateOne: { update: { $set: Record<string, unknown> } } }> | undefined;
    for (const op of ops ?? []) {
      expect(op.updateOne.update.$set).not.toHaveProperty("labourResiduals");
    }
  });

  it("with no cabinet contribution, the cabinet channel adds no drift (regression)", async () => {
    const values = flatValues(50);
    wire({
      metricsDocs: [
        { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
      ],
    });
    // findOne default (null) → no contribution.
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);

    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as
      Array<{ updateOne: { update: { $set: { values: Record<string, number> } } } }> | undefined;
    // Whether the engine families moved enough to trigger a write is not this
    // test's business; that every family nothing else bends stayed exactly put is.
    const next = ops?.[0]?.updateOne.update.$set.values ?? values;
    const families = unmodelledFamilies(values);
    expect(families.length).toBeGreaterThan(0);
    for (const id of families) expect(next[id]).toBe(50);
  });
});

describe("trend history (§5)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "politicalMetrics",
      "statePolicies",
      "states",
      "politicalMetricsHistory",
      "politicalCabinetContribution",
      "macroMetrics",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue(null);
    const values = flatValues(50);
    // The phase derives its country list from the collection, so a fixture
    // without `distinct` would process nothing at all.
    db.collectionMocks.politicalMetrics.distinct = vi.fn().mockResolvedValue(["UK"]);
    db.collectionMocks.politicalMetrics.find = vi
      .fn()
      .mockImplementation((filter?: { countryId?: string }) => ({
        toArray: vi.fn().mockResolvedValue(
          filter?.countryId === "UK"
            ? [
                {
                  _id: "R1",
                  countryId: "UK",
                  values: { ...values, "health.universalCare": 40 },
                  residuals: equilibriumResiduals("UK", values),
                },
                {
                  _id: "R2",
                  countryId: "UK",
                  values: { ...values, "health.universalCare": 70 },
                  residuals: equilibriumResiduals("UK", values),
                },
              ]
            : []
        ),
      }));
    db.collectionMocks.statePolicies.find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collectionMocks.states.find = vi.fn().mockImplementation(() =>
      cursorOf([
        { _id: "R1", countryId: "UK", population: 1_000_000 },
        { _id: "R2", countryId: "UK", population: 3_000_000 },
      ])
    );
  });

  it("appends a pop-weighted national snapshot with the 365 cap on the 24-turn cadence", async () => {
    await processPoliticalMetricsDynamics(db as unknown as Db, 48);
    const call = (db.collectionMocks.politicalMetricsHistory.updateOne as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(call[0]).toEqual({ _id: "UK" });
    const update = call[1] as {
      $push: {
        entries: { $each: Array<{ turn: number; values: Record<string, number> }>; $slice: number };
      };
    };
    expect(update.$push.entries.$slice).toBe(-365);
    const entry = update.$push.entries.$each[0];
    expect(entry.turn).toBe(48);
    // The snapshot is the POST-DRIFT population-weighted mean, 1M vs 3M. Taken
    // from the values actually written rather than from a hand-computed target:
    // the composed target now carries the bounded engine term, and hardcoding a
    // law-only target here would be asserting the engine channel is off. What
    // this test is about is the aggregation and the cadence, not the target.
    const written = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { values: Record<string, number> } } };
    }>;
    const byRegion = new Map(
      written.map((o) => [o.updateOne.filter._id, o.updateOne.update.$set.values])
    );
    const expected =
      (byRegion.get("R1")!["health.universalCare"] * 1 +
        byRegion.get("R2")!["health.universalCare"] * 3) /
      4;
    expect(entry.values["health.universalCare"]).toBeCloseTo(expected, 6);
    // Both regions share a target, so the SPREAD between them narrows. Not
    // "R1 rose": with no budgets seeded the causal model reads this country as
    // funding nothing, which can put the shared target below both regions —
    // convergence is the invariant here, direction is not.
    const spread = Math.abs(
      byRegion.get("R2")!["health.universalCare"] - byRegion.get("R1")!["health.universalCare"]
    );
    expect(spread).toBeLessThan(70 - 40);
  });

  it("does not append off-cadence", async () => {
    await processPoliticalMetricsDynamics(db as unknown as Db, 47);
    expect(db.collectionMocks.politicalMetricsHistory.updateOne).not.toHaveBeenCalled();
  });
});

describe("Bridge B — macro conditions bend the political equilibrium", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "politicalMetrics",
      "statePolicies",
      "states",
      "politicalMetricsHistory",
      "macroMetrics",
    ]) {
      db.collection(name);
    }
  });

  function runWith(macroDocs: unknown[]) {
    // Each call is an independent run: the mock db is shared across a test, so
    // without this reset `bulkWrite.mock.calls[0]` would always be the FIRST
    // invocation and every comparison would read the same value twice.
    db.collectionMocks.politicalMetrics.bulkWrite.mockClear();
    const values = flatValues(50);
    const doc = {
      _id: "MA",
      countryId: "US",
      values,
      residuals: equilibriumResiduals("US", values),
    };
    // The phase derives its country list from the collection, so a fixture
    // without `distinct` would process nothing at all.
    db.collectionMocks.politicalMetrics.distinct = vi.fn().mockResolvedValue(["US"]);
    db.collectionMocks.politicalMetrics.find = vi
      .fn()
      .mockImplementation((f?: { countryId?: string }) => ({
        toArray: vi.fn().mockResolvedValue(f?.countryId === "US" ? [doc] : []),
      }));
    db.collectionMocks.statePolicies.find = vi
      .fn()
      .mockImplementation(() => ({ toArray: vi.fn().mockResolvedValue([]) }));
    db.collectionMocks.macroMetrics.find = vi
      .fn()
      .mockImplementation((f?: { countryId?: string }) => ({
        toArray: vi
          .fn()
          .mockResolvedValue(
            (macroDocs as Array<{ countryId?: string }>).filter((d) => d.countryId === f?.countryId)
          ),
      }));
    return processPoliticalMetricsDynamics(db as unknown as Db, 100).then(() => {
      const call = db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0]?.[0] as
        Array<{ updateOne: { update: { $set: Record<string, unknown> } } }> | undefined;
      return call?.[0]?.updateOne.update.$set;
    });
  }

  const macroDoc = (unemployment: number, costOfLiving: number) => ({
    _id: "MA",
    countryId: "US",
    economic: {
      unemploymentRate: { value: unemployment },
      costOfLiving: { value: costOfLiving },
    },
  });

  it("drives economy.stability LOWER in a depression than in a boom", async () => {
    const boom = await runWith([macroDoc(2, 30)]);
    const bust = await runWith([macroDoc(22, 95)]);
    const boomVal = (boom?.values as Record<string, number>)["economy.stability"];
    const bustVal = (bust?.values as Record<string, number>)["economy.stability"];
    expect(bustVal).toBeLessThan(boomVal);
  });

  it("never persists the macro term into the stored residuals", async () => {
    // `residuals` means "the permanent structural gap set at reset" and the lazy
    // self-heal recomputes it as value − composedLawTarget. Writing a transient
    // macro term there would corrupt every later heal.
    const bust = await runWith([macroDoc(22, 95)]);
    expect(bust?.residuals).toBeUndefined();
  });

  it("reaches a family with no DIRECT macro source through the causal chain", async () => {
    // This asserted equality before the engine term existed: `order.safety` has
    // no TIER2_SOURCES row, so Bridge B could never touch it and a depression
    // left it alone. It is no longer alone — the engine's public-safety nodes
    // read economic conditions, so macro now reaches the family INDIRECTLY, via
    // the modelled causal chain rather than the direct bridge. A slump making
    // the streets less safe is the intended behaviour; the old equality would
    // now be asserting that the causal channel is disconnected.
    const boom = await runWith([macroDoc(2, 30)]);
    const bust = await runWith([macroDoc(22, 95)]);
    const pick = (r: Record<string, unknown> | undefined) =>
      (r?.values as Record<string, number>)["order.safety"];
    expect(pick(bust)).toBeLessThan(pick(boom));
    // Still no DIRECT bridge: the family has no macro sources of its own.
    expect(TIER2_SOURCES["order.safety"]).toBeUndefined();
  });
});

describe("engine term — funded services bend the political equilibrium", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  /** Same UK region twice, differing only in how much the budget funds. */
  async function runWithEducationSpend(perCapita: number): Promise<Record<string, number>> {
    const values = flatValues(50);
    const docs = [
      { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
    ];
    db.collection("politicalMetrics").distinct = vi.fn().mockResolvedValue(["UK"]);
    db.collection("politicalMetrics").find = vi.fn().mockImplementation(() => cursorOf(docs));
    db.collection("macroMetrics").find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collection("statePolicies").find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collection("states").find = vi
      .fn()
      .mockImplementation(() => cursorOf([{ _id: "R1", countryId: "UK", population: 1_000_000 }]));
    // gdp/pop = 24k so the cross-country normalization factor is exactly 1 and
    // the per-capita figure below is the number the channel actually sees.
    db.collection("federalBudget").find = vi.fn().mockImplementation(() =>
      cursorOf([
        {
          _id: "UK",
          countryId: "UK",
          gdp: 24_000 * 1_000_000,
          spending: { byCategory: { education: perCapita * 1_000_000 } },
        },
      ])
    );
    db.collection("stateBudgets").find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collection("politicalMetrics").bulkWrite.mockClear();
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      updateOne: { update: { $set: { values: Record<string, number> } } };
    }>;
    return ops[0].updateOne.update.$set.values;
  }

  it("funding schools raises the education families' equilibrium", async () => {
    // THE capability the engine term exists to preserve. Both runs are the same
    // region at the same law levels; the ONLY difference is the education
    // budget, so any divergence is the causal channel reaching the board.
    const starved = await runWithEducationSpend(0);
    const funded = await runWithEducationSpend(6_500);
    const educationFamilies = Object.keys(funded).filter((id) => id.startsWith("education."));
    expect(educationFamilies.length).toBeGreaterThan(0);
    const moved = educationFamilies.filter((id) => funded[id] !== starved[id]);
    expect(moved.length).toBeGreaterThan(0);
    for (const id of moved) expect(funded[id]).toBeGreaterThan(starved[id]);
  });

  it("leaves the stored residuals alone — the term is per-turn, not structural", async () => {
    // Same rule Bridge B follows: `residuals` is the structural gap fixed at
    // reset and the self-heal recomputes it from the composed LAW target, so
    // banking a per-turn causal term into it would corrupt every later heal —
    // and would make one well-funded turn permanently redefine the country.
    const values = flatValues(50);
    db.collection("politicalMetrics").distinct = vi.fn().mockResolvedValue(["UK"]);
    db.collection("politicalMetrics").find = vi
      .fn()
      .mockImplementation(() =>
        cursorOf([
          { _id: "R1", countryId: "UK", values, residuals: equilibriumResiduals("UK", values) },
        ])
      );
    db.collection("macroMetrics").find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collection("statePolicies").find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collection("states").find = vi
      .fn()
      .mockImplementation(() => cursorOf([{ _id: "R1", countryId: "UK", population: 1_000_000 }]));
    await processPoliticalMetricsDynamics(db as unknown as Db, 5);
    const ops = (db.collectionMocks.politicalMetrics.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>;
    expect(ops[0].updateOne.update.$set.residuals).toBeUndefined();
  });
});
