import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { composeTarget, lawTargets } from "@/lib/politicalLegislation/dynamics";
import { loadCountryPoliticalMetrics } from "./countryPoliticalMetrics";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function baselineLevels() {
  return new Map(
    getCatalog("UK")
      .filter((l) => l.kind !== "tax")
      .map((l) => [l.id, l.baselineLevel ?? 0])
  );
}

function fullValues(score: number) {
  const values: Record<string, number> = {};
  for (const law of getCatalog("UK")) {
    if (law.kind === "tax") continue;
    for (const t of law.targets) values[t.metricId] = score;
  }
  return values;
}

describe("countryPoliticalMetrics — SP2 payload (history + modifiers)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "politicalMetrics",
      "states",
      "gameState",
      "statePolicies",
      "politicalMetricsHistory",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.politicalMetrics.find = vi.fn().mockImplementation(() => ({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "R1", countryId: "UK", values: fullValues(60), residuals: {} }]),
    }));
    db.collectionMocks.states.find = vi.fn().mockImplementation(() => ({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "R1", name: "Region One", population: 1_000_000, gdp: 19_800 }]),
    }));
    db.collectionMocks.gameState.findOne = vi
      .fn()
      .mockResolvedValue({ currentYear: 1953, currentTurn: 100 });
    // National statePolicies at authored baselines for the enacted-levels readback.
    db.collectionMocks.statePolicies.find = vi.fn().mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue(
        getCatalog("UK")
          .filter((l) => l.kind !== "tax")
          .map((l) => ({ legislationTypeId: l.id, policyOptionIndex: l.baselineLevel ?? 0 }))
      ),
    }));
    db.collectionMocks.politicalMetricsHistory.findOne = vi.fn().mockResolvedValue({
      _id: "UK",
      entries: [
        { turn: 24, values: { "health.universalCare": 61.2 } },
        { turn: 48, values: { "health.universalCare": 62.8 } },
      ],
    });
  });

  it("extracts each metric's history series in turn order", async () => {
    const response = await loadCountryPoliticalMetrics("UK", db as unknown as Db);
    const metric = response!.categories
      .flatMap((c) => c.metrics)
      .find((m) => m.id === "health.universalCare")!;
    expect(metric.history).toEqual([
      { turn: 24, value: 61.2 },
      { turn: 48, value: 62.8 },
    ]);
  });

  it("modifiers rows + residual reproduce the target; direction follows the gap", async () => {
    const response = await loadCountryPoliticalMetrics("UK", db as unknown as Db);
    const metric = response!.categories
      .flatMap((c) => c.metrics)
      .find((m) => m.id === "health.universalCare")!;
    const points = lawTargets("UK", baselineLevels())["health.universalCare"];
    const lawSum = metric.modifiers.laws.reduce((s, r) => s + r.points, 0);
    expect(lawSum).toBeCloseTo(points, 6);
    // Residuals {} → lazy view residual = value − points; target = value → flat.
    expect(metric.modifiers.target).toBeCloseTo(
      Math.round(composeTarget(points, 0, 60 - points) * 10) / 10,
      6
    );
    expect(metric.modifiers.direction).toBe("flat");
  });

  it("returns an empty history when no history doc exists", async () => {
    db.collectionMocks.politicalMetricsHistory.findOne = vi.fn().mockResolvedValue(null);
    const response = await loadCountryPoliticalMetrics("UK", db as unknown as Db);
    const metric = response!.categories.flatMap((c) => c.metrics)[0];
    expect(metric.history).toEqual([]);
  });
});
