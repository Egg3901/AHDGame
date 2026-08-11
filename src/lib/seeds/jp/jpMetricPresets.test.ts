import { describe, expect, it } from "vitest";
import {
  jpMetricPresets2019,
  jpMetricPresets1991,
  JP_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/jp/jpMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const JP_REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of JP_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of JP_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("JP metric presets — author list", () => {
  it("authors the expected 44 JP-relevant metrics", () => {
    expect(JP_AUTHORED_METRIC_PATHS.length).toBe(44);
  });
});

describe("JP metric presets — 2019 (authored, seed-preserving)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(jpMetricPresets2019, "2019");
  });

  it("preserves the seed's authored per-region values (robotics, gender equality)", () => {
    // Kanto's high robotics + Shikoku's low gender equality come straight from the seed.
    expect(jpMetricPresets2019.KAN["governance.roboticsAdoption"]).toBe(82);
    expect(jpMetricPresets2019.SHI["social.genderEquality"]).toBe(25);
  });

  it("has metro/rural spread on the authored-fresh metrics", () => {
    expect(jpMetricPresets2019.KAN["economic.propertyValueIndex"]).toBeGreaterThan(
      jpMetricPresets2019.SHI["economic.propertyValueIndex"]
    );
  });
});

describe("JP metric presets — 1991 (authored, bubble peak)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(jpMetricPresets1991, "1991");
  });

  it("is era-correct vs 2019 on unambiguous metrics", () => {
    for (const region of JP_REGIONS) {
      const a91 = jpMetricPresets1991[region];
      const a19 = jpMetricPresets2019[region];
      // Still-rising over the lost decades: R&D, robotics, energy transition; debt exploded.
      expect(a91["economic.rdIntensity"]).toBeLessThan(a19["economic.rdIntensity"]);
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
      // Bubble peak + pre-China dominance: property & manufacturing were HIGHER in 1991.
      expect(a91["economic.propertyValueIndex"]).toBeGreaterThan(
        a19["economic.propertyValueIndex"]
      );
      expect(a91["economic.manufacturingCompetitiveness"]).toBeGreaterThan(
        a19["economic.manufacturingCompetitiveness"]
      );
    }
  });
});
