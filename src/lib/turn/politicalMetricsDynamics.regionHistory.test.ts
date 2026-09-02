import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { lawTargets } from "@/lib/politicalLegislation/dynamics";
import {
  HISTORY_CADENCE_TURNS,
  REGION_HISTORY_MAX_ENTRIES,
  processPoliticalMetricsDynamics,
} from "./politicalMetricsDynamics";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/unions/labourRelationsPoliticalProvider", () => ({
  loadLabourRelationsPoliticalNudgesByCountry: vi.fn().mockResolvedValue(new Map()),
}));

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

function baselineLevels(countryId: "UK") {
  return new Map(
    getCatalog(countryId)
      .filter((l) => l.kind !== "tax")
      .map((l) => [l.id, l.baselineLevel ?? 0])
  );
}

function flatValues(score: number) {
  const values: Record<string, number> = {};
  for (const law of getCatalog("UK")) {
    if (law.kind === "tax") continue;
    for (const t of law.targets) values[t.metricId] = score;
  }
  return values;
}

function equilibriumResiduals(values: Record<string, number>) {
  const national = lawTargets("UK", baselineLevels("UK"));
  const residuals: Record<string, number> = {};
  for (const [metricId, points] of Object.entries(national)) {
    residuals[metricId] = (values[metricId] ?? 0) - points;
  }
  return residuals;
}

type HistoryOp = {
  updateOne: {
    filter: { _id: string };
    update: {
      $push: {
        entries: { $each: Array<{ turn: number; values: Record<string, number> }>; $slice: number };
      };
      $set: { countryId: string; updatedAt: Date };
    };
    upsert: boolean;
  };
};

describe("processPoliticalMetricsDynamics — per-region history (#1322)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "politicalMetrics",
      "statePolicies",
      "states",
      "politicalMetricsHistory",
      "politicalMetricsRegionHistory",
      "politicalCabinetContribution",
      "macroMetrics",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.politicalCabinetContribution.findOne = vi.fn().mockResolvedValue(null);
  });

  /** Two UK regions, both at equilibrium unless `values` displaces them. */
  function wire(docs: Array<{ _id: string; values: Record<string, number> }>) {
    db.collectionMocks.macroMetrics.find = vi.fn().mockImplementation(() => cursorOf([]));
    db.collectionMocks.politicalMetrics.distinct = vi.fn().mockResolvedValue(["UK"]);
    db.collectionMocks.politicalMetrics.find = vi.fn().mockImplementation(() =>
      cursorOf(
        docs.map((d) => ({
          _id: d._id,
          countryId: "UK",
          values: d.values,
          residuals: equilibriumResiduals(flatValues(50)),
        }))
      )
    );
    db.collectionMocks.statePolicies.find = vi.fn().mockImplementation(() =>
      cursorOf(
        getCatalog("UK")
          .filter((l) => l.kind !== "tax")
          .map((l) => ({ legislationTypeId: l.id, policyOptionIndex: l.baselineLevel ?? 0 }))
      )
    );
    db.collectionMocks.states.find = vi
      .fn()
      .mockImplementation(() =>
        cursorOf(docs.map((d) => ({ _id: d._id, countryId: "UK", population: 1_000_000 })))
      );
  }

  function historyOps(): HistoryOp[] {
    const bulkWrite = db.collectionMocks.politicalMetricsRegionHistory.bulkWrite as ReturnType<
      typeof vi.fn
    >;
    return (bulkWrite.mock.calls.at(-1)?.[0] ?? []) as HistoryOp[];
  }

  it("writes one capped, upserting push per region on a cadence turn", async () => {
    wire([
      { _id: "R1", values: flatValues(50) },
      { _id: "R2", values: flatValues(50) },
    ]);
    await processPoliticalMetricsDynamics(db as unknown as Db, HISTORY_CADENCE_TURNS);

    const ops = historyOps();
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.updateOne.filter._id).sort()).toEqual(["R1", "R2"]);
    for (const op of ops) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$push.entries.$slice).toBe(-REGION_HISTORY_MAX_ENTRIES);
      expect(op.updateOne.update.$push.entries.$each[0].turn).toBe(HISTORY_CADENCE_TURNS);
      expect(op.updateOne.update.$set.countryId).toBe("UK");
    }
  });

  it("writes nothing on a non-cadence turn", async () => {
    wire([{ _id: "R1", values: flatValues(50) }]);
    await processPoliticalMetricsDynamics(db as unknown as Db, HISTORY_CADENCE_TURNS + 1);
    expect(db.collectionMocks.politicalMetricsRegionHistory.bulkWrite).not.toHaveBeenCalled();
  });

  it("snapshots POST-drift values, not the values read at the top of the turn", async () => {
    // Displace R1 well below equilibrium so the drift step must move it. The
    // snapshot has to record where the region ENDED the turn; recording the
    // pre-drift read would make every series lag reality by one cadence.
    const displaced = flatValues(20);
    wire([{ _id: "R1", values: displaced }]);
    await processPoliticalMetricsDynamics(db as unknown as Db, HISTORY_CADENCE_TURNS);

    const entry = historyOps()[0].updateOne.update.$push.entries.$each[0];
    const sampleId = Object.keys(displaced)[0];
    expect(entry.values[sampleId]).not.toBe(20);
    expect(entry.values[sampleId]).toBeGreaterThan(20);
  });
});
