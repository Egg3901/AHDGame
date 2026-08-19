import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { composeTarget, lawTargets } from "@/lib/politicalLegislation/dynamics";
import { CABINET_RESIDUAL_CAP_PER_SOURCE, CABINET_SOURCE_IDS } from "../cabinetResidual";
import { DRIFT_RATE_PER_TURN } from "@/lib/politicalLegislation/dynamics";
import { driftHalfLifeTurns, loadCountryPoliticalMetrics } from "./countryPoliticalMetrics";

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
  /**
   * Ticket #1129 regression. Players reported that built estates did nothing.
   * The cabinet term WAS being written and folded into the target the engine
   * drifts toward, but the served payload left it out entirely, so the panel
   * showed a target that disagreed with the engine and no surface named the
   * estates at all.
   */
  describe("ticket #1129 — the cabinet term is served, not silently dropped", () => {
    function withCabinet(
      cabinet: Record<string, number>,
      bySource?: Record<string, Record<string, number>>
    ) {
      db.collectionMocks.politicalMetrics.find = vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "R1",
            countryId: "UK",
            values: fullValues(60),
            residuals: {},
            cabinetResiduals: cabinet,
            ...(bySource ? { cabinetResidualsBySource: bySource } : {}),
          },
        ]),
      }));
    }

    async function healthMetric() {
      const response = await loadCountryPoliticalMetrics("UK", db as unknown as Db);
      return response!.categories
        .flatMap((c) => c.metrics)
        .find((m) => m.id === "health.universalCare")!;
    }

    it("reports the population-weighted cabinet term and folds it into the target", async () => {
      withCabinet({ "health.universalCare": 5 });
      const metric = await healthMetric();
      const points = lawTargets("UK", baselineLevels())["health.universalCare"];
      expect(metric.modifiers.cabinet).toBe(5);
      // Structural residual is the lazy view (value − points); cabinet rides on top.
      expect(metric.modifiers.target).toBeCloseTo(
        Math.round(composeTarget(points, 0, 60 - points + 5) * 10) / 10,
        6
      );
      // The target now leads the value, so the panel says so.
      expect(metric.modifiers.direction).toBe("up");
    });

    /**
     * The cap is per channel since the ticket-1129 balance pass, so "at cap"
     * means EVERY channel is full. One pinned channel out of six is the normal
     * case a player can still build their way out of, and warning them off it
     * would repeat the bug in words.
     */
    it("flags saturation only when every cabinet channel is pinned", async () => {
      const everyChannel = Object.fromEntries(
        CABINET_SOURCE_IDS.map((s) => [
          s,
          { "health.universalCare": CABINET_RESIDUAL_CAP_PER_SOURCE },
        ])
      );
      withCabinet(
        { "health.universalCare": CABINET_RESIDUAL_CAP_PER_SOURCE * CABINET_SOURCE_IDS.length },
        everyChannel
      );
      const metric = await healthMetric();
      expect(metric.modifiers.cabinetAtCap).toBe(true);
      expect(metric.modifiers.cabinetCap).toBe(CABINET_RESIDUAL_CAP_PER_SOURCE);
    });

    it("does not flag saturation when one channel is pinned and others are free", async () => {
      withCabinet(
        { "health.universalCare": CABINET_RESIDUAL_CAP_PER_SOURCE },
        { orders: { "health.universalCare": CABINET_RESIDUAL_CAP_PER_SOURCE } }
      );
      const metric = await healthMetric();
      expect(metric.modifiers.cabinetAtCap).toBe(false);
    });

    it("does not flag saturation below the ceiling", async () => {
      withCabinet({ "health.universalCare": CABINET_RESIDUAL_CAP_PER_SOURCE - 1 });
      const metric = await healthMetric();
      expect(metric.modifiers.cabinetAtCap).toBe(false);
    });

    it("treats a doc with no cabinetResiduals as a zero term", async () => {
      const metric = await healthMetric();
      expect(metric.modifiers.cabinet).toBe(0);
      expect(metric.modifiers.cabinetAtCap).toBe(false);
    });

    it("serves the drift half-life derived from the engine rate", async () => {
      const metric = await healthMetric();
      expect(metric.modifiers.driftHalfLifeTurns).toBe(driftHalfLifeTurns(DRIFT_RATE_PER_TURN));
      // Ticket #1129 retune: 0.005 gave a 138 turn half-life, which reads as
      // nothing happening. 0.02 gives ~34, slow enough to stay structural and
      // fast enough to be visible inside a session.
      expect(DRIFT_RATE_PER_TURN).toBe(0.02);
      expect(metric.modifiers.driftHalfLifeTurns).toBe(34);
    });
  });

  describe("driftHalfLifeTurns", () => {
    it("inverts the per-turn drift rate", () => {
      expect(driftHalfLifeTurns(0.5)).toBe(1);
      expect(driftHalfLifeTurns(0.005)).toBe(138);
      expect(driftHalfLifeTurns(0.02)).toBe(34);
    });

    it("returns 0 for rates outside (0, 1)", () => {
      expect(driftHalfLifeTurns(0)).toBe(0);
      expect(driftHalfLifeTurns(1)).toBe(0);
    });
  });
});
