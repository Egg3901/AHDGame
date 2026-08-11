/**
 * Regression: metric-engine node.bounds must admit the 1953 world gradient.
 *
 * The first floor (metricDefinitions lifeExpectancy minValue:70) was fixed to 35,
 * but ahd_sim_preflightfx still showed world-wide min LE exactly 70.0 after a
 * 2-turn bootstrap — the binding clamp was lifeExpectancyNode.bounds [70,85]
 * (and literacyRateNode.bounds [80,99]) applied by evalNode every turn.
 *
 * Assert the SPREAD survives cold-start eval, not merely that one number is
 * correct: TR below 60, CN near the era floor, SE above 70, and max−min large.
 */
import { describe, expect, it } from "vitest";
import { evalNode } from "./coexistence";
import type { EngineNodeContext } from "./types";
import { lifeExpectancyNode } from "./registry/healthcare";
import { literacyRateNode } from "./registry/education";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import type { CountryId } from "@/lib/constants/countries";

function coldCtx(policyValue: number, current: Record<string, number> = {}): EngineNodeContext {
  return {
    current,
    prev: {},
    prevSimBaseline: {},
    providers: {},
    spending: {},
    policyValue,
  };
}

/** Authored 1953 life expectancy at birth for regions that define the world gradient. */
const ERA_1953_LIFE: Array<{ country: CountryId; region: string; label: string }> = [
  { country: "CN", region: "HD", label: "China (low)" },
  { country: "TR", region: "TR_IST", label: "Turkey Istanbul" },
  { country: "ES", region: "ES_AND", label: "Spain Andalusia" },
  { country: "IT", region: "IT_NW", label: "Italy" },
  { country: "SE", region: "SE_STH", label: "Sweden Stockholm" },
];

describe("era bounds — lifeExpectancy spread survives evalNode", () => {
  it("node.bounds admit China≈43 … Sweden≈72 (not a Western [70,85] slice)", () => {
    expect(lifeExpectancyNode.bounds[0]).toBeLessThanOrEqual(35);
    expect(lifeExpectancyNode.bounds[1]).toBeGreaterThanOrEqual(85);
  });

  it("cold-start eval preserves authored 1953 LE values (no snap to a uniform floor)", () => {
    const values: number[] = [];
    for (const { country, region, label } of ERA_1953_LIFE) {
      const overlay = getRegionMetricPresets(country, region, "1953-default");
      const seeded = overlay?.["healthcare.lifeExpectancy"];
      expect(typeof seeded, `${label} overlay lifeExpectancy`).toBe("number");

      // Neutral mid-chain inputs so compute() returns a modern-shaped target;
      // coexistence must still preserve the seeded policyValue via policyDelta.
      const out = evalNode(
        lifeExpectancyNode,
        coldCtx(seeded as number, {
          "healthcare.physicianRate": 2.5,
          "healthcare.preventableMortality": 310,
          "healthcare.affordabilityIndex": 50,
        }),
        region
      );
      values.push(out.value);
      expect(out.value, `${label} survived eval`).toBeCloseTo(seeded as number, 0);
    }

    const tr = values[1];
    const se = values[4];
    const spread = Math.max(...values) - Math.min(...values);
    expect(tr, "TR must stay below the old 70 floor").toBeLessThan(60);
    expect(se, "SE authored peak must survive").toBeGreaterThan(70);
    expect(spread, "world LE spread must remain large").toBeGreaterThan(20);
  });

  it("a seeded 48 is NOT clamped to 70 on cold-start (the preflightfx signature)", () => {
    const out = evalNode(
      lifeExpectancyNode,
      coldCtx(48, {
        "healthcare.physicianRate": 2.5,
        "healthcare.preventableMortality": 310,
        "healthcare.affordabilityIndex": 50,
      }),
      "TR_IST"
    );
    expect(out.value).toBeCloseTo(48, 0);
    expect(out.value).toBeLessThan(60);
  });
});

describe("era bounds — literacyRate spread survives evalNode", () => {
  it("node.bounds admit TR east ≈15 … SE ≈99 (not a US [80,99] slice)", () => {
    expect(literacyRateNode.bounds[0]).toBeLessThanOrEqual(15);
    expect(literacyRateNode.bounds[1]).toBeGreaterThanOrEqual(99);
  });

  it("cold-start eval preserves TR_IST literacy 55 (not snapped to 80)", () => {
    const overlay = getRegionMetricPresets("TR", "TR_IST", "1953-default");
    const seeded = overlay!["education.literacyRate"] as number;
    expect(seeded).toBe(55);

    const out = evalNode(
      literacyRateNode,
      coldCtx(seeded, { "education.highSchoolGradRate": 88 }),
      "TR_IST"
    );
    expect(out.value).toBeCloseTo(55, 0);
    expect(out.value).toBeLessThan(80);
  });
});
