import { describe, expect, it } from "vitest";
import {
  ukMetricPresets2019,
  ukMetricPresets1991,
  UK_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/uk/ukMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const UK_REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of UK_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of UK_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("UK metric presets — author list", () => {
  it("authors the expected 47 UK-relevant metrics (incl. nhs/gcse/bbc)", () => {
    expect(UK_AUTHORED_METRIC_PATHS.length).toBe(47);
  });
});

describe("UK metric presets — 2019 (authored, seed-preserving)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(ukMetricPresets2019, "2019");
  });

  it("preserves the seed's authored per-region values (gcse, nhs waits, bbc)", () => {
    expect(ukMetricPresets2019.LON["education.gcseAttainment"]).toBe(68);
    expect(ukMetricPresets2019.NIR["healthcare.nhsWaitingTime"]).toBe(26);
    expect(ukMetricPresets2019.SCO["mediaInformation.bbcTrust"]).toBe(48);
  });

  it("has authored-fresh spread (London R&D > the North East)", () => {
    expect(ukMetricPresets2019.LON["economic.rdIntensity"]).toBeGreaterThan(
      ukMetricPresets2019.NEE["economic.rdIntensity"]
    );
  });
});

describe("UK metric presets — 1991 (authored, Major-era recession)", () => {
  it("covers every region × every authored metric, within bounds", () => {
    expectCoverageAndBounds(ukMetricPresets1991, "1991");
  });

  it("is era-correct vs 2019 on unambiguous metrics", () => {
    for (const region of UK_REGIONS) {
      const a91 = ukMetricPresets1991[region];
      const a19 = ukMetricPresets2019[region];
      // Rose since 1991: robotics, energy transition, public debt, and devolution
      // (no Scottish/Welsh/NI legislatures existed in 1991).
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
      expect(a91["governance.devolutionSatisfaction"]).toBeLessThan(
        a19["governance.devolutionSatisfaction"]
      );
      // Fell since 1991: a larger manufacturing base (deindustrialisation) and lower
      // nominal house-price-to-income ratios (the long housing boom).
      expect(a91["economic.manufacturingCompetitiveness"]).toBeGreaterThan(
        a19["economic.manufacturingCompetitiveness"]
      );
      expect(a91["economic.propertyValueIndex"]).toBeLessThan(a19["economic.propertyValueIndex"]);
    }
  });
});
