import { describe, expect, it } from "vitest";
import {
  deMetricPresets2019,
  deMetricPresets1991,
  DE_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/de/deMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

const DE_REGIONS = [
  "BW",
  "BY",
  "NW",
  "HE",
  "RP",
  "SL",
  "NI",
  "SH",
  "HH",
  "BRE",
  "BE",
  "BB",
  "MV",
  "SN",
  "ST",
  "TH",
];

function bounds(path: string): { min: number; max: number } {
  const [cat, id] = path.split(".");
  const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
  return { min: def?.minValue ?? 0, max: def?.maxValue ?? 100 };
}

function expectCoverageAndBounds(bundle: Record<string, Record<string, number>>, era: string) {
  for (const region of DE_REGIONS) {
    const preset = bundle[region];
    expect(preset, `${era} preset for ${region}`).toBeTruthy();
    for (const path of DE_AUTHORED_METRIC_PATHS) {
      const v = preset[path];
      expect(typeof v, `${era} ${region}.${path}`).toBe("number");
      const { min, max } = bounds(path);
      expect(v, `${era} ${region}.${path} >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(v, `${era} ${region}.${path} <= ${max}`).toBeLessThanOrEqual(max);
    }
  }
}

describe("DE metric presets — author list", () => {
  it("authors the expected 45 DE-relevant metrics", () => {
    expect(DE_AUTHORED_METRIC_PATHS.length).toBe(45);
  });
});

describe("DE metric presets — 2019 (authored)", () => {
  it("covers every Land × every authored metric, within bounds", () => {
    expectCoverageAndBounds(deMetricPresets2019, "2019");
  });

  it("has real West/East spread (southern industry vs former-GDR periphery)", () => {
    // Baden-Württemberg (industrial south) vs Saxony-Anhalt / Mecklenburg (East periphery).
    expect(deMetricPresets2019.BW["economic.rdIntensity"]).toBeGreaterThan(
      deMetricPresets2019.MV["economic.rdIntensity"]
    );
    expect(deMetricPresets2019.BW["economic.manufacturingCompetitiveness"]).toBeGreaterThan(
      deMetricPresets2019.ST["economic.manufacturingCompetitiveness"]
    );
    // The East leads on wind-energy transition.
    expect(deMetricPresets2019.MV["environment.energyTransitionProgress"]).toBeGreaterThan(
      deMetricPresets2019.NW["environment.energyTransitionProgress"]
    );
  });
});

describe("DE metric presets — 1991 (authored)", () => {
  it("covers every Land × every authored metric, within bounds", () => {
    expectCoverageAndBounds(deMetricPresets1991, "1991");
  });

  // Unambiguous era directions. NOTE: DE-1991 debtToGdp is LOWER than 2019 (~40 vs 66 —
  // the reunification-cost debt ramp came later), the opposite of Ireland.
  it("is era-correct vs 2019 on unambiguous metrics", () => {
    for (const region of DE_REGIONS) {
      const a91 = deMetricPresets1991[region];
      const a19 = deMetricPresets2019[region];
      expect(a91["economic.rdIntensity"]).toBeLessThan(a19["economic.rdIntensity"]);
      expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
      expect(a91["environment.energyTransitionProgress"]).toBeLessThan(
        a19["environment.energyTransitionProgress"]
      );
      expect(a91["governance.debtToGdp"]).toBeLessThan(a19["governance.debtToGdp"]);
    }
  });

  it("reflects the post-reunification East collapse (East << West on output)", () => {
    // Saxony (Treuhand-era) far below Bavaria on manufacturing in 1991.
    expect(deMetricPresets1991.SN["economic.manufacturingCompetitiveness"]).toBeLessThan(
      deMetricPresets1991.BY["economic.manufacturingCompetitiveness"]
    );
  });
});
