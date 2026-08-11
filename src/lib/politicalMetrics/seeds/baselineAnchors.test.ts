import { describe, expect, it } from "vitest";
import {
  POLITICAL_BASELINE_ANCHORS,
  baselineFor,
  interpolateAnchors,
  validateAnchorTable,
} from "./baselineAnchors";
import { NATIONAL_BASELINES_1953 } from "./nationalBaselines1953";
import { POLITICAL_METRIC_COUNTRY_IDS, type PoliticalMetricId } from "../types";

describe("interpolateAnchors", () => {
  const anchors = [
    { year: 1950, value: 20 },
    { year: 2000, value: 70 },
  ];

  it("returns the exact value at an anchor year", () => {
    expect(interpolateAnchors(anchors, 1950)).toBe(20);
    expect(interpolateAnchors(anchors, 2000)).toBe(70);
  });

  it("interpolates linearly between anchors", () => {
    expect(interpolateAnchors(anchors, 1975)).toBeCloseTo(45, 10);
  });

  it("clamps below the first and above the last anchor", () => {
    expect(interpolateAnchors(anchors, 1800)).toBe(20);
    expect(interpolateAnchors(anchors, 2500)).toBe(70);
  });

  it("handles a single anchor as a constant", () => {
    expect(interpolateAnchors([{ year: 1953, value: 42 }], 1800)).toBe(42);
    expect(interpolateAnchors([{ year: 1953, value: 42 }], 2400)).toBe(42);
  });
});

describe("baselineFor", () => {
  it("reproduces the 1953 authored value exactly for every country and family", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      const authored = NATIONAL_BASELINES_1953[countryId];
      for (const [metricId, baseline] of Object.entries(authored)) {
        expect(baselineFor(countryId, metricId as PoliticalMetricId, 1953)).toBe(baseline.value);
      }
    }
  });

  it("throws for a family with no anchors rather than defaulting", () => {
    expect(() => baselineFor("US", "not.afamily" as PoliticalMetricId, 1953)).toThrow(
      /no baseline anchors/i
    );
  });
});

describe("validateAnchorTable", () => {
  it("reports no problems for the shipped table", () => {
    expect(validateAnchorTable()).toEqual([]);
  });

  it("covers every country and every family", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      const authored = Object.keys(NATIONAL_BASELINES_1953[countryId]);
      const anchored = Object.keys(POLITICAL_BASELINE_ANCHORS[countryId]);
      expect(anchored.sort()).toEqual(authored.sort());
    }
  });
});
