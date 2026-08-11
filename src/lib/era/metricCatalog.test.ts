import { describe, it, expect } from "vitest";
import {
  isMetricActive,
  getEraBand,
  getEraEnvelope,
  getEraMetricName,
  getNewlyActivatedMetrics,
} from "./metricCatalog";
import { metricCategories } from "@/lib/constants/metricDefinitions";

describe("isMetricActive", () => {
  it("always active when year is null (flag off) regardless of window", () => {
    expect(isMetricActive("broadbandAccess", "US", null)).toBe(true);
  });

  it("always active for metrics with no window", () => {
    expect(isMetricActive("unemploymentRate", "US", 1953)).toBe(true);
  });

  it("gates on the base from year (from-1 inactive, from active)", () => {
    expect(isMetricActive("broadbandAccess", "US", 1997)).toBe(false);
    expect(isMetricActive("broadbandAccess", "US", 1998)).toBe(true);
  });

  it("countryOverrides shift the year for that country only", () => {
    expect(isMetricActive("broadbandAccess", "NG", 2007)).toBe(false);
    expect(isMetricActive("broadbandAccess", "NG", 2008)).toBe(true);
    expect(isMetricActive("broadbandAccess", "US", 2007)).toBe(true);
  });

  it("countries-scoped windows gate only listed countries", () => {
    expect(isMetricActive("devolutionSatisfaction", "UK", 1998)).toBe(false);
    expect(isMetricActive("devolutionSatisfaction", "UK", 1999)).toBe(true);
    expect(isMetricActive("devolutionSatisfaction", "DE", 1953)).toBe(true);
  });

  it("undefined countryId uses the base from", () => {
    expect(isMetricActive("broadbandAccess", undefined, 1997)).toBe(false);
    expect(isMetricActive("broadbandAccess", undefined, 1998)).toBe(true);
  });
});

describe("getEraBand", () => {
  it("null when year is null / metric uncurved / medianIncome", () => {
    expect(getEraBand("unemploymentRate", "US", null)).toBeNull();
    expect(getEraBand("nhsWaitingTime", "UK", 1979)).toBeNull();
    expect(getEraBand("medianIncome", "US", 1991)).toBeNull();
  });

  it("prefers country anchors over global; unauthored country falls to global", () => {
    // UK 1953 era-normal 1.8 → best floored at 0.5 (spread −2, floor 0.5).
    const uk = getEraBand("unemploymentRate", "UK", 1950)!;
    expect(uk.best).toBeCloseTo(0.5);
    expect(uk.worst).toBeCloseTo(12.8);
    // RU is not one of the 8 authored countries → global (US-shaped) anchors.
    const ru = getEraBand("unemploymentRate", "RU", 1950)!;
    expect(ru.best).toBeCloseTo(2.5);
  });
});

describe("getEraEnvelope", () => {
  it("null when year null or metric not enveloped", () => {
    expect(getEraEnvelope("broadbandAccess", "US", null)).toBeNull();
    expect(getEraEnvelope("carbonEmissions", "US", 1991)).toBeNull(); // lower-better: exempt
  });

  it("pre-window hold: limit 0", () => {
    expect(getEraEnvelope("broadbandAccess", "US", 1980)).toEqual({ limit: 0, kind: "ceiling" });
  });

  it("post-window: interpolated rising limit", () => {
    const e2005 = getEraEnvelope("broadbandAccess", "US", 2005)!;
    const e1999 = getEraEnvelope("broadbandAccess", "US", 1999)!;
    expect(e2005.limit).toBeGreaterThan(e1999.limit);
  });
});

describe("getEraMetricName", () => {
  const gcse = metricCategories.flatMap((c) => c.metrics).find((m) => m.id === "gcseAttainment")!;
  it("relabels before the until year, base name from it", () => {
    expect(getEraMetricName(gcse, 1979)).toBe("O-Level Attainment");
    expect(getEraMetricName(gcse, 1988)).toBe(gcse.name);
    expect(getEraMetricName(gcse, null)).toBe(gcse.name);
  });
});

describe("getNewlyActivatedMetrics", () => {
  it("returns base activation crossing from-year, with countries scope", () => {
    const acts = getNewlyActivatedMetrics(1997, 1998);
    expect(acts.some((a) => a.metricId === "broadbandAccess" && a.countries === null)).toBe(true);
  });

  it("returns a SEPARATE event with override news for override years", () => {
    const acts = getNewlyActivatedMetrics(2007, 2008);
    const ng = acts.find((a) => a.metricId === "broadbandAccess");
    expect(ng?.countries).toEqual(["NG"]);
    expect(ng?.news.title).toBe("Broadband Reaches Nigeria");
  });

  it("empty for a range crossing nothing", () => {
    expect(getNewlyActivatedMetrics(1994, 1995)).toEqual([]);
  });
});
