import { describe, expect, it } from "vitest";
import {
  brMetricPresets2019,
  brMetricPresets1991,
  BR_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/br/brMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const BR_REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of BR_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of BR_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("BR metric presets — author list", () => {
  it("authors the expected 44 BR-relevant metrics", () => {
    expect(BR_AUTHORED_METRIC_PATHS.length).toBe(44);
  });
});

describe("BR metric presets — 2019 (authored)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(brMetricPresets2019, "2019");
  });

  it("has real regional spread (Sudeste engine vs Norte/Nordeste periphery)", () => {
    expect(brMetricPresets2019.SUDESTE["economic.rdIntensity"]).toBeGreaterThan(
      brMetricPresets2019.NORDESTE["economic.rdIntensity"]
    );
    expect(brMetricPresets2019.SUDESTE["economic.propertyValueIndex"]).toBeGreaterThan(
      brMetricPresets2019.NORTE["economic.propertyValueIndex"]
    );
  });
});

describe("BR metric presets — 1991 (authored, hyperinflation era)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(brMetricPresets1991, "1991");
  });

  it("is era-correct vs 2019 on unambiguous metrics", () => {
    for (const region of BR_REGIONS) {
      const a91 = brMetricPresets1991[region];
      const a19 = brMetricPresets2019[region];
      // Rising across the post-Real decades: R&D, robotics, energy transition; debt grew.
      expect(a91["economic.rdIntensity"]).toBeLessThan(a19["economic.rdIntensity"]);
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
      // Younger population in 1991 → less demographic-aging pressure.
      expect(a91["population.demographicDecline"]).toBeLessThan(
        a19["population.demographicDecline"]
      );
      // Collor recession: productivity was contracting in 1991.
      expect(a91["economic.productivityGrowth"]).toBeLessThan(a19["economic.productivityGrowth"]);
    }
  });
});
