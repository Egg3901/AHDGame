import { describe, expect, it } from "vitest";
import {
  cnMetricPresets2019,
  cnMetricPresets1991,
  CN_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/cn/cnMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const CN_REGIONS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of CN_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of CN_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("CN metric presets — author list", () => {
  it("authors the expected 44 CN-relevant metrics", () => {
    expect(CN_AUTHORED_METRIC_PATHS.length).toBe(44);
  });
});

describe("CN metric presets — 2019 (authored)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(cnMetricPresets2019, "2019");
  });

  it("has real coastal/interior spread (Huadong/Huanan vs Xibei)", () => {
    expect(cnMetricPresets2019.HD["economic.rdIntensity"]).toBeGreaterThan(
      cnMetricPresets2019.XB["economic.rdIntensity"]
    );
    expect(cnMetricPresets2019.HD["economic.propertyValueIndex"]).toBeGreaterThan(
      cnMetricPresets2019.DB["economic.propertyValueIndex"]
    );
  });
});

describe("CN metric presets — 1991 (authored, early Deng-era reform)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(cnMetricPresets1991, "1991");
  });

  it("is era-correct vs 2019 across China's transformation", () => {
    for (const region of CN_REGIONS) {
      const a91 = cnMetricPresets1991[region];
      const a19 = cnMetricPresets2019[region];
      // Everything industrial/financial surged: R&D, robotics, energy, property,
      // manufacturing, debt; population aged.
      expect(a91["economic.rdIntensity"]).toBeLessThan(a19["economic.rdIntensity"]);
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["economic.propertyValueIndex"]).toBeLessThan(a19["economic.propertyValueIndex"]);
      expect(a91["economic.manufacturingCompetitiveness"]).toBeLessThan(
        a19["economic.manufacturingCompetitiveness"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
      expect(a91["population.demographicDecline"]).toBeLessThan(
        a19["population.demographicDecline"]
      );
      // …but the Mao-era female-workforce legacy was STRONGER in 1991 than today.
      expect(a91["social.genderEquality"]).toBeGreaterThan(a19["social.genderEquality"]);
    }
  });
});
