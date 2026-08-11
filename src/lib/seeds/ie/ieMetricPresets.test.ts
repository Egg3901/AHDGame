import { describe, expect, it } from "vitest";
import {
  ieMetricPresets2019,
  ieMetricPresets1991,
  IE_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/ie/ieMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const IE_REGIONS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of IE_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of IE_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("IE metric presets — author list", () => {
  it("authors the expected 43 IE-relevant metrics", () => {
    expect(IE_AUTHORED_METRIC_PATHS.length).toBe(43);
  });
});

describe("IE metric presets — 2019 (authored)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(ieMetricPresets2019, "2019");
  });

  it("has real per-region spread (capital/tech-hub vs rural periphery)", () => {
    // Dublin/Cork are R&D/MNC hubs; Donegal is the rural periphery.
    expect(ieMetricPresets2019.DUB["economic.rdIntensity"]).toBeGreaterThan(
      ieMetricPresets2019.DON["economic.rdIntensity"]
    );
    // Housing pressure (lower = better) is worst in Dublin, lowest in the rural border.
    expect(ieMetricPresets2019.DUB["social.housingAffordability"]).toBeGreaterThan(
      ieMetricPresets2019.DON["social.housingAffordability"]
    );
  });
});

describe("IE metric presets — 1991 (authored)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(ieMetricPresets1991, "1991");
  });

  // Unambiguous era directions (assert only the certain ones, per the spec precedent).
  it("is era-correct vs 2019 on unambiguous metrics", () => {
    for (const region of IE_REGIONS) {
      const a91 = ieMetricPresets1991[region];
      const a19 = ieMetricPresets2019[region];
      // Pre-Tiger: far lower R&D, robotics, energy transition.
      expect(a91["economic.rdIntensity"]).toBeLessThan(a19["economic.rdIntensity"]);
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      // IE-1991 debt/GDP (~95%) was far HIGHER than the post-Tiger 2019 level (~43%).
      expect(a91["governance.debtToGdp"]).toBeGreaterThan(a19["governance.debtToGdp"]);
      // Catholic-conservative social order → lower gender equality + civil liberties.
      expect(a91["social.genderEquality"]).toBeLessThan(a19["social.genderEquality"]);
      expect(a91["governance.civilLiberties"]).toBeLessThan(a19["governance.civilLiberties"]);
      // Higher state-media control (RTÉ monopoly + Section 31 broadcasting ban).
      expect(a91["mediaInformation.stateMediaControl"]).toBeGreaterThan(
        a19["mediaInformation.stateMediaControl"]
      );
    }
  });
});
