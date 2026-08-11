import { describe, expect, it } from "vitest";
import type { EngineNodeContext, NodeId } from "../types";
import {
  ENVIRONMENT_NODES,
  carbonEmissionsNode,
  airQualityNode,
  energyTransitionProgressNode,
  floodRiskNode,
  agriEmissionsShareNode,
  mixIntensity,
  CARBON_INTENSITY,
  REFERENCE_MIX_INTENSITY,
} from "./environment";

type Rows = Array<{ revenue: number; sectorType?: keyof typeof CARBON_INTENSITY }>;

function ctx(over: {
  current?: Record<NodeId, number>;
  prev?: Record<NodeId, number>;
  spending?: Record<string, number>;
  rows?: Rows;
}): EngineNodeContext {
  return {
    current: over.current ?? {},
    prev: over.prev ?? {},
    prevSimBaseline: {},
    providers: over.rows
      ? {
          sectorRevenueTax: {
            owned: over.rows,
            unowned: [],
            federalSalesTax: 0,
            stateSalesTax: 0,
            countryId: "US",
          },
        }
      : {},
    spending: over.spending ?? {},
    policyValue: NaN,
  };
}

/** Reference state: carbon 12 t/cap, AQI 44, renewables 25, resilience 60. */
const REF = {
  current: {
    "environment.renewableEnergy": 25,
    "environment.carbonEmissions": 12,
    "environment.climateResilience": 60,
    "population.urbanizationRate": 55,
  },
};

describe("environment registry nodes (P3c)", () => {
  it("exports all 5 nodes with environment storage paths", () => {
    expect(ENVIRONMENT_NODES).toHaveLength(5);
    for (const n of ENVIRONMENT_NODES) {
      expect(n.id).toBe(`environment.${n.metricId}`);
      expect(n.categoryId).toBe("environment");
      expect(n.bounds[0]).toBeLessThan(n.bounds[1]);
    }
  });

  describe("registration + topo (Task 3)", () => {
    it("all 5 nodes register and carbon orders before airQuality", async () => {
      const { METRIC_REGISTRY, METRIC_REGISTRY_SORTED } = await import("./index");
      const ids = new Set(METRIC_REGISTRY.map((n) => n.id));
      for (const n of ENVIRONMENT_NODES) expect(ids.has(n.id), n.id).toBe(true);
      const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
      expect(order.get("environment.carbonEmissions")!).toBeLessThan(
        order.get("environment.airQuality")!
      );
    });
  });

  describe("mixIntensity", () => {
    it("is the revenue-weighted mean intensity; reference when empty or untyped", () => {
      expect(mixIntensity([])).toBeCloseTo(REFERENCE_MIX_INTENSITY, 5);
      expect(mixIntensity([{ revenue: 100 }])).toBeCloseTo(REFERENCE_MIX_INTENSITY, 5);
      expect(mixIntensity([{ revenue: 100, sectorType: "energy" }])).toBeCloseTo(3, 5);
      expect(
        mixIntensity([
          { revenue: 100, sectorType: "energy" }, // 3
          { revenue: 300, sectorType: "financial" }, // 0.3
        ])
      ).toBeCloseTo((100 * 3 + 300 * 0.3) / 400, 5);
    });
  });

  describe("carbonEmissions (tons/capita, LOWER better)", () => {
    it("anchors at 12 at the reference state (no sector data, renewables 25, no spend)", () => {
      expect(carbonEmissionsNode.compute!(ctx(REF))).toBeCloseTo(12, 5);
    });

    it("heavy-industry mix raises it; clean mix, renewables, and env spend lower it", () => {
      const base = carbonEmissionsNode.compute!(ctx(REF));
      const heavy = carbonEmissionsNode.compute!(
        ctx({ ...REF, rows: [{ revenue: 100, sectorType: "energy" }] })
      );
      const clean = carbonEmissionsNode.compute!(
        ctx({ ...REF, rows: [{ revenue: 100, sectorType: "financial" }] })
      );
      const green = carbonEmissionsNode.compute!(
        ctx({ current: { ...REF.current, "environment.renewableEnergy": 80 } })
      );
      const funded = carbonEmissionsNode.compute!(ctx({ ...REF, spending: { environment: 30 } }));
      expect(heavy).toBeGreaterThan(base);
      expect(clean).toBeLessThan(base);
      expect(green).toBeLessThan(base);
      expect(funded).toBeLessThan(base);
    });

    it("spans the THRESHOLDS band [3, 25] across realistic best/worst inputs", () => {
      const worst = carbonEmissionsNode.compute!(
        ctx({
          current: { ...REF.current, "environment.renewableEnergy": 5 },
          rows: [{ revenue: 100, sectorType: "manufacturing" }],
        })
      );
      expect(worst).toBeGreaterThan(17);
      expect(worst).toBeLessThan(26);
    });
  });

  describe("airQuality (AQI, LOWER better)", () => {
    it("anchors at 44 and worsens (rises) with carbon + urbanization, improves with renewables", () => {
      expect(airQualityNode.compute!(ctx(REF))).toBeCloseTo(44, 5);
      const dirty = airQualityNode.compute!(
        ctx({ current: { ...REF.current, "environment.carbonEmissions": 22 } })
      );
      const urban = airQualityNode.compute!(
        ctx({ current: { ...REF.current, "population.urbanizationRate": 90 } })
      );
      const green = airQualityNode.compute!(
        ctx({ current: { ...REF.current, "environment.renewableEnergy": 70 } })
      );
      expect(dirty).toBeGreaterThan(44);
      expect(urban).toBeGreaterThan(44);
      expect(green).toBeLessThan(44);
    });

    it("stays near the THRESHOLDS band [8, 80] at the extremes", () => {
      const best = airQualityNode.compute!(
        ctx({
          current: {
            "environment.carbonEmissions": 3,
            "population.urbanizationRate": 40,
            "environment.renewableEnergy": 80,
          },
        })
      );
      const worst = airQualityNode.compute!(
        ctx({
          current: {
            "environment.carbonEmissions": 25,
            "population.urbanizationRate": 90,
            "environment.renewableEnergy": 5,
          },
        })
      );
      expect(best).toBeGreaterThan(5);
      expect(best).toBeLessThan(25);
      expect(worst).toBeGreaterThan(65);
      expect(worst).toBeLessThan(82);
    });
  });

  describe("energyTransitionProgress", () => {
    it("aligns with the uniform-seed derivation (renewables + 10) and responds to env spend", () => {
      expect(energyTransitionProgressNode.compute!(ctx(REF))).toBeCloseTo(35, 5);
      const funded = energyTransitionProgressNode.compute!(
        ctx({ ...REF, spending: { environment: 30 } })
      );
      expect(funded).toBeGreaterThan(35);
    });
  });

  describe("floodRisk (UK-origin, uniform-seeded, LOWER better)", () => {
    it("matches the uniform-seed derivation (18 − resilience·0.12)", () => {
      expect(floodRiskNode.compute!(ctx(REF))).toBeCloseTo(18 - 60 * 0.12, 5);
      const resilient = floodRiskNode.compute!(
        ctx({ current: { ...REF.current, "environment.climateResilience": 90 } })
      );
      expect(resilient).toBeLessThan(18 - 60 * 0.12);
    });
  });

  describe("agriEmissionsShare (IE-only, % of modeled emissions from agriculture)", () => {
    it("is agriculture's share of intensity-weighted revenue; IE seed anchor when no rows", () => {
      expect(agriEmissionsShareNode.compute!(ctx({}))).toBeCloseTo(38, 5);
      const agHeavy = agriEmissionsShareNode.compute!(
        ctx({
          rows: [
            { revenue: 300, sectorType: "agriculture" }, // 300·1.5 = 450
            { revenue: 700, sectorType: "technology" }, // 700·0.4 = 280
          ],
        })
      );
      expect(agHeavy).toBeCloseTo((450 / 730) * 100, 1);
      const agLight = agriEmissionsShareNode.compute!(
        ctx({
          rows: [
            { revenue: 50, sectorType: "agriculture" },
            { revenue: 950, sectorType: "manufacturing" },
          ],
        })
      );
      expect(agLight).toBeLessThan(agHeavy);
    });
  });
});
