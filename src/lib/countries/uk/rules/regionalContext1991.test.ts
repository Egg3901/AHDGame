import { describe, expect, it } from "vitest";
import {
  ECONOMIC_LEAN_PER_MARGIN_POINT,
  MAX_REGIONAL_OFFSET,
  UK_REGION_CROSSWALK_1991,
  UK_REGION_POPULATION_1991,
  regionalMargin,
  ukRegionalContext1991,
} from "./regionalContext1991";
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";

describe("UK 1991 regional context", () => {
  const context = ukRegionalContext1991();

  it("crosswalk weights sum to one and every region has a population", () => {
    for (const [region, weights] of Object.entries(UK_REGION_CROSSWALK_1991)) {
      expect(
        Object.values(weights).reduce((a, b) => a + b, 0),
        region
      ).toBeCloseTo(1, 10);
      expect(UK_REGION_POPULATION_1991[region], region).toBeGreaterThan(0);
    }
  });

  it("orders regions by the published Labour minus Conservative margin", () => {
    const ordered = Object.keys(context).sort(
      (a, b) => context[a].economicLean - context[b].economicLean
    );
    // Most left first: Labour's Wales, Scotland and the North, the Conservative South last.
    expect(ordered.slice(0, 3).sort()).toEqual(["NEE", "SCO", "WAL"]);
    expect(ordered.slice(-3).sort()).toEqual(["EAE", "SEE", "SWE"]);
  });

  it("is centred on the population-weighted mean and bounded", () => {
    let weighted = 0;
    let people = 0;
    for (const [region, offset] of Object.entries(context)) {
      weighted += offset.economicLean * UK_REGION_POPULATION_1991[region];
      people += UK_REGION_POPULATION_1991[region];
      expect(Math.abs(offset.economicLean)).toBeLessThanOrEqual(MAX_REGIONAL_OFFSET + 0.02);
    }
    expect(weighted / people).toBeCloseTo(0, 1);
  });

  it("moves only the economic axis and leaves Northern Ireland alone", () => {
    for (const offset of Object.values(context)) expect(offset.socialLean).toBe(0);
    expect(context.NIR).toBeUndefined();
  });

  it("scales a margin gap at the documented rate", () => {
    const gap =
      regionalMargin(UK_REGION_CROSSWALK_1991.NEE) - regionalMargin(UK_REGION_CROSSWALK_1991.SEE);
    expect(context.SEE.economicLean - context.NEE.economicLean).toBeCloseTo(
      gap * ECONOMIC_LEAN_PER_MARGIN_POINT,
      1
    );
  });

  it("widens the derived regional spread without moving the national mean or the social axis", () => {
    const leans = deriveRegionLeans("UK", "1991");
    const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));
    const econ = leans.map((l) => l.economic);
    expect(Math.max(...econ) - Math.min(...econ)).toBeGreaterThan(1.8);
    expect(byId.SEE.economic).toBeGreaterThan(byId.NEE.economic + 1.5);
    expect(byId.SCO.economic).toBeLessThan(byId.EAE.economic);
    const mean = econ.reduce((a, b) => a + b, 0) / econ.length;
    expect(mean).toBeGreaterThan(-2.2);
    expect(mean).toBeLessThan(-1.2);
    // Social contrast stays composition driven: it is not widened by vote shares.
    const social = leans.map((l) => l.social);
    expect(Math.max(...social) - Math.min(...social)).toBeLessThan(0.3);
  });
});
