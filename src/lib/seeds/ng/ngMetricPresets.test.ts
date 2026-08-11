import { describe, expect, it } from "vitest";
import {
  ngMetricPresets2019,
  ngMetricPresets1991,
  NG_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/ng/ngMetricPresets";
import { metricCategories } from "@/lib/constants/metricDefinitions";

// NG is played as six geopolitical zones (see ngRegions / ngStateMetrics).
const NG_ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];

describe("NG metric presets — author list", () => {
  it("authors a non-empty set of NG-relevant metrics", () => {
    expect(NG_AUTHORED_METRIC_PATHS.length).toBeGreaterThan(0);
  });

  it("every authored path references a real metric definition", () => {
    for (const path of NG_AUTHORED_METRIC_PATHS) {
      const [cat, id] = path.split(".");
      const def = metricCategories.find((c) => c.id === cat)?.metrics.find((x) => x.id === id);
      expect(def, `unknown metric path ${path}`).toBeTruthy();
    }
  });
});

describe("NG metric presets — 2019 (authored)", () => {
  // Coverage + well-formedness only. We intentionally do NOT assert each value
  // against the metric's global min/max: Nigeria legitimately authors several
  // developing-country values below Western-calibrated metric floors (e.g.
  // education.highSchoolGradRate ≈ 35 vs a 55 floor); the engine clamps at
  // runtime, and re-calibrating global metric bounds is a separate balance task.
  it("covers every zone × every authored metric with a finite number", () => {
    for (const zone of NG_ZONES) {
      const preset = ngMetricPresets2019[zone];
      expect(preset, `2019 preset for ${zone}`).toBeTruthy();
      for (const path of NG_AUTHORED_METRIC_PATHS) {
        const v = preset[path];
        expect(typeof v, `2019 ${zone}.${path}`).toBe("number");
        expect(Number.isFinite(v), `2019 ${zone}.${path} finite`).toBe(true);
      }
    }
  });
});

describe("NG metric presets — 1991 (authored, Babangida/SAP era)", () => {
  it("covers every zone × every authored metric with a finite number", () => {
    for (const zone of NG_ZONES) {
      const preset = ngMetricPresets1991[zone];
      expect(preset, `1991 preset for ${zone}`).toBeTruthy();
      for (const path of NG_AUTHORED_METRIC_PATHS) {
        const v = preset[path];
        expect(typeof v, `1991 ${zone}.${path}`).toBe("number");
        expect(Number.isFinite(v), `1991 ${zone}.${path} finite`).toBe(true);
      }
    }
  });

  it("is era-correct vs 2019 on signature SAP-era shifts (national NORTH_CENTRAL proxy)", () => {
    const a91 = ngMetricPresets1991.NORTH_CENTRAL;
    const a19 = ngMetricPresets2019.NORTH_CENTRAL;
    // Military debt crisis: higher debt; pre-boom property values; weaker civil
    // liberties; less robotics/energy transition; more state media control.
    expect(a91["governance.debtToGdp"]).toBeGreaterThan(a19["governance.debtToGdp"]);
    expect(a91["economic.propertyValueIndex"]).toBeLessThan(a19["economic.propertyValueIndex"]);
    expect(a91["governance.civilLiberties"]).toBeLessThan(a19["governance.civilLiberties"]);
    expect(a91["governance.roboticsAdoption"]).toBeLessThan(a19["governance.roboticsAdoption"]);
    expect(a91["mediaInformation.stateMediaControl"]).toBeGreaterThan(
      a19["mediaInformation.stateMediaControl"]
    );
  });
});
