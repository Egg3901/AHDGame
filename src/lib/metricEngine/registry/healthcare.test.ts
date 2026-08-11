import { describe, expect, it } from "vitest";
import type { EngineNodeContext } from "../types";
import {
  physicianRateNode,
  affordabilityIndexNode,
  preventableMortalityNode,
  lifeExpectancyNode,
  elderCareQualityNode,
  nhsWaitingTimeNode,
  hseWaitingListMonthsNode,
  HEALTHCARE_NODES,
} from "./healthcare";

function ctx(partial: {
  spending?: Record<string, number>;
  current?: Record<string, number>;
  prev?: Record<string, number>;
}): EngineNodeContext {
  return {
    current: partial.current ?? {},
    prev: partial.prev ?? {},
    prevSimBaseline: {},
    providers: {},
    spending: partial.spending ?? {},
    policyValue: NaN,
  };
}

describe("healthcare nodes — direction", () => {
  it("physicianRate rises with healthcare spend (capacity)", () => {
    const low = physicianRateNode.compute!(ctx({ spending: { healthcare: 0.2 } }));
    const high = physicianRateNode.compute!(ctx({ spending: { healthcare: 12 } }));
    expect(high).toBeGreaterThan(low);
  });

  it("affordability falls with uninsured share and cost of living", () => {
    const base = ctx({
      spending: { healthcare: 2 },
      current: { "healthcare.uninsuredRate": 5, "economic.costOfLiving": 100 },
    });
    const worse = ctx({
      spending: { healthcare: 2 },
      current: { "healthcare.uninsuredRate": 20, "economic.costOfLiving": 140 },
    });
    expect(affordabilityIndexNode.compute!(base)).toBeGreaterThan(
      affordabilityIndexNode.compute!(worse)
    );
  });

  it("preventableMortality falls with physicians/preparedness, rises with poverty", () => {
    const good = preventableMortalityNode.compute!(
      ctx({
        current: {
          "healthcare.physicianRate": 4.5,
          "healthcare.uninsuredRate": 3,
          "healthcare.publicHealthPreparedness": 80,
        },
        prev: { "economic.povertyRate": 8 },
      })
    );
    const bad = preventableMortalityNode.compute!(
      ctx({
        current: {
          "healthcare.physicianRate": 1.5,
          "healthcare.uninsuredRate": 20,
          "healthcare.publicHealthPreparedness": 30,
        },
        prev: { "economic.povertyRate": 25 },
      })
    );
    expect(good).toBeLessThan(bad);
  });

  it("lifeExpectancy (YEARS) rises with access, falls with preventable mortality + poverty", () => {
    const good = lifeExpectancyNode.compute!(
      ctx({
        current: {
          "healthcare.physicianRate": 4.5,
          "healthcare.preventableMortality": 150,
          "healthcare.affordabilityIndex": 80,
        },
        // airQuality is an AQI — LOWER is better (15 = clean air).
        prev: { "environment.airQuality": 15, "economic.povertyRate": 8 },
      })
    );
    const bad = lifeExpectancyNode.compute!(
      ctx({
        current: {
          "healthcare.physicianRate": 1.5,
          "healthcare.preventableMortality": 480,
          "healthcare.affordabilityIndex": 30,
        },
        prev: { "environment.airQuality": 75, "economic.povertyRate": 25 },
      })
    );
    expect(good).toBeGreaterThan(bad);
    // years scale sanity
    expect(good).toBeGreaterThan(75);
    expect(bad).toBeLessThan(80);
  });

  it("cleaner air (LOWER AQI) raises life expectancy — P3c sign fix", () => {
    const base = {
      current: {
        "healthcare.physicianRate": 2.5,
        "healthcare.preventableMortality": 310,
        "healthcare.affordabilityIndex": 50,
      },
    };
    const clean = lifeExpectancyNode.compute!(
      ctx({ ...base, prev: { "environment.airQuality": 20, "economic.povertyRate": 13 } })
    );
    const smog = lifeExpectancyNode.compute!(
      ctx({ ...base, prev: { "environment.airQuality": 70, "economic.povertyRate": 13 } })
    );
    expect(clean).toBeGreaterThan(smog);
  });

  it("elder demand (dependency ratio) strains elder care and lengthens waiting lists", () => {
    const young = ctx({
      spending: { healthcare: 2 },
      current: { "population.dependencyRatio": 0.45 },
    });
    const aged = ctx({
      spending: { healthcare: 2 },
      current: { "population.dependencyRatio": 0.85 },
    });
    expect(elderCareQualityNode.compute!(young)).toBeGreaterThan(
      elderCareQualityNode.compute!(aged)
    );
    expect(nhsWaitingTimeNode.compute!(aged)).toBeGreaterThan(nhsWaitingTimeNode.compute!(young));
    expect(hseWaitingListMonthsNode.compute!(aged)).toBeGreaterThan(
      hseWaitingListMonthsNode.compute!(young)
    );
  });
});

describe("healthcare nodes — well-formed", () => {
  it("finite output at neutral inputs; metadata sane", () => {
    for (const node of HEALTHCARE_NODES) {
      const out = node.compute!(ctx({ spending: { healthcare: 2 } }));
      expect(Number.isFinite(out), `${node.id} finite`).toBe(true);
      expect(node.bounds[0]).toBeLessThan(node.bounds[1]);
      expect(node.kind).toBe("derived");
      expect(node.id.startsWith("healthcare.")).toBe(true);
    }
  });

  it("zero spend is safe (no NaN/Infinity)", () => {
    for (const node of HEALTHCARE_NODES) {
      expect(Number.isFinite(node.compute!(ctx({}))), `${node.id} at zero spend`).toBe(true);
    }
  });
});
