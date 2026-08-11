import { describe, expect, it } from "vitest";
import {
  usMetricPresets2019,
  usMetricPresets1991,
  US_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/reference/usMetricPresets";
import { stateMetrics as usStateMetrics } from "@/lib/seeds/reference/stateMetrics";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const US_REGIONS = usStateMetrics.map((m) => String(m._id));

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of US_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of US_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("US metric presets — author list", () => {
  it("authors the expected 46 US-relevant metrics", () => {
    expect(US_AUTHORED_METRIC_PATHS.length).toBe(46);
  });
});

describe("US metric presets — 2019 (authored)", () => {
  it("covers all 51 regions (50 states + DC) × every authored metric, within bounds", () => {
    expect(US_REGIONS.length).toBe(51);
    expectCoverageAndBounds(usMetricPresets2019, "2019");
  });

  it("has real archetype spread (tech coast vs Deep South)", () => {
    expect(usMetricPresets2019.CA["economic.rdIntensity"]).toBeGreaterThan(
      usMetricPresets2019.MS["economic.rdIntensity"]
    );
    expect(usMetricPresets2019.CA["economic.propertyValueIndex"]).toBeGreaterThan(
      usMetricPresets2019.WV["economic.propertyValueIndex"]
    );
  });
});

describe("US metric presets — 1991 (authored, post-Cold-War)", () => {
  it("covers all 51 regions × every authored metric, within bounds", () => {
    expectCoverageAndBounds(usMetricPresets1991, "1991");
  });

  it("is era-correct vs 2019 across every region", () => {
    for (const region of US_REGIONS) {
      const a91 = usMetricPresets1991[region];
      const a19 = usMetricPresets2019[region];
      // Rose since 1991: robotics, energy transition, public debt.
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
      expect(a91["economic.propertyValueIndex"]).toBeLessThan(a19["economic.propertyValueIndex"]);
      // Fell since 1991: a larger manufacturing base and the Cold-War-peak military.
      expect(a91["economic.manufacturingCompetitiveness"]).toBeGreaterThan(
        a19["economic.manufacturingCompetitiveness"]
      );
      expect(a91["governance.militaryReadiness"]).toBeGreaterThan(
        a19["governance.militaryReadiness"]
      );
      // Fell since 1991: pre-Brady/pre-AWB firearm regimes were looser.
      expect(a91["publicSafety.firearmRights"]).toBeGreaterThan(a19["publicSafety.firearmRights"]);
    }
  });
});
