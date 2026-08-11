import { INCOME_ANCHORS } from "@/lib/era/metricCatalog";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { describe, expect, it } from "vitest";
import {
  getMetricThreshold,
  scoreMetric,
  THRESHOLDS,
  MEDIAN_INCOME_THRESHOLDS,
} from "./metricScoring";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

describe("era-aware metric bands (absolute per-country curves)", () => {
  it("no year → identical to legacy (regression invariant)", () => {
    expect(getMetricThreshold("unemploymentRate", "US", "2019-default")).toEqual(
      THRESHOLDS.unemploymentRate
    );
    expect(scoreMetric("gdpGrowth", 2.5, "US", "2019-default")).toBe(
      scoreMetric("gdpGrowth", 2.5, "US", "2019-default", null)
    );
    // legacy medianIncome preset ×0.4 path untouched
    expect(getMetricThreshold("medianIncome", "UK", "1991-default", null)).toEqual({
      best: MEDIAN_INCOME_THRESHOLDS.UK.best * 0.4,
      worst: MEDIAN_INCOME_THRESHOLDS.UK.worst * 0.4,
    });
  });

  it("year set → catalog curve wins; country anchors beat global; uncurved falls to static", () => {
    const uk1950 = getMetricThreshold("unemploymentRate", "UK", "1953-default", 1950)!;
    expect(uk1950.best).toBeCloseTo(0.5); // UK country anchors (1953 normal 1.8, floored)
    const ru1950 = getMetricThreshold("unemploymentRate", "RU", "1953-default", 1950)!;
    expect(ru1950.best).toBeCloseTo(2.5); // RU unauthored → global anchors
    // no curve at all → static band unchanged (waterQuality gained a US curve
    // in #3238; publicTransit remains uncurved)
    expect(getMetricThreshold("publicTransit", "US", "1953-default", 1953)).toEqual(
      THRESHOLDS.publicTransit
    );
  });

  it("inactive metric ⇒ scoreMetric null; active/legacy paths score", () => {
    expect(scoreMetric("broadbandAccess", 0, "US", "1953-default", 1953)).toBeNull();
    expect(scoreMetric("broadbandAccess", 0, "US", "1953-default", null)).not.toBeNull();
    expect(scoreMetric("broadbandAccess", 50, "US", "2019-default", 2019)).not.toBeNull();
  });

  it("medianIncome flag-on composes anchor(startingYear) × shape × index", () => {
    const anchor = getIncomeAnchor("UK", 1991)!;
    const t = getMetricThreshold("medianIncome", "UK", "1991-default", 2008, 1.2, 1991)!;
    expect(t.best).toBeCloseTo(anchor * 1.25 * 1.2, 6);
    expect(t.worst).toBeCloseTo(anchor * 0.45 * 1.2, 6);
  });

  it("medianIncome flag-on but index/anchor missing ⇒ FULL legacy band (never half-era)", () => {
    expect(getMetricThreshold("medianIncome", "UK", "1991-default", 2008, null, 1991)).toEqual(
      getMetricThreshold("medianIncome", "UK", "1991-default", null)
    );
    // Anchor missing (country outside the authored table). Derived rather than
    // hardcoded: this fixture has already rotated twice as countries gained
    // anchors (RU, then FR), and a stale name makes the test assert nothing.
    const latent = Object.keys(COUNTRY_CONFIGS).find(
      (cc) => !INCOME_ANCHORS[cc as keyof typeof INCOME_ANCHORS]
    );
    expect(latent, "every country now has an income anchor — drop this case").toBeDefined();
    expect(getMetricThreshold("medianIncome", latent, "1991-default", 2008, 1.2, 1991)).toEqual(
      getMetricThreshold("medianIncome", latent, "1991-default", null)
    );
  });

  it("approval exclusion set: 1953-default now excluded flag-off; flag-on superseded by windows", async () => {
    const { getApprovalExcludedMetrics } = await import("./governmentApproval");
    // pre-existing bug fix: 1953-default joins the pre-2000 preset set (flag off)
    expect(getApprovalExcludedMetrics("1953-default", null).has("broadbandAccess")).toBe(true);
    // flag on: windows govern — renewableEnergy (window 1974) is NOT in the set at 1995
    expect(getApprovalExcludedMetrics("1991-default", 1995).has("renewableEnergy")).toBe(false);
    expect(getApprovalExcludedMetrics("1991-default", 1995).has("broadbandAccess")).toBe(false);
    // legacy behavior unchanged when year is null
    expect(getApprovalExcludedMetrics("1991-default", null).has("renewableEnergy")).toBe(true);
  });

  it("a 1950 UK value scores better under era bands than modern ones", () => {
    // 4% unemployment: middling for the modern band, weak for 1950 UK (best 1.5, worst 8).
    const era = scoreMetric("unemploymentRate", 1.6, "UK", "1953-default", 1950)!;
    const modern = scoreMetric("unemploymentRate", 1.6, "UK", "1953-default", null)!;
    expect(era).toBeGreaterThan(0);
    expect(era).not.toBe(modern);
  });
});

describe("#3238 saturation-set curves — 1953/1979 seeds land mid-band", () => {
  // Seed normals sourced from stateMetrics1953/1979.ts (US) and the per-country
  // ${cc}MetricPresets1953/1979.ts files. Every case below pinned at 0 or 100
  // against the static band before the curves were authored.
  const MID = (s: number | null) => {
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThanOrEqual(25);
    expect(s!).toBeLessThanOrEqual(75);
  };

  it("1953 seed normals score mid-band (previously pinned)", () => {
    MID(scoreMetric("educationSpending", 350, "US", "1953-default", 1953)); // was 0
    MID(scoreMetric("uninsuredRate", 38, "US", "1953-default", 1953)); // was 0
    MID(scoreMetric("uninsuredRate", 40, "JP", "1953-default", 1953)); // was 0
    MID(scoreMetric("uninsuredRate", 72, "BR", "1953-default", 1953)); // was 0
    MID(scoreMetric("uninsuredRate", 80, "CN", "1953-default", 1953)); // was 0
    MID(scoreMetric("uninsuredRate", 95, "NG", "1953-default", 1953)); // was 0
    MID(scoreMetric("rdIntensity", 0.7, "US", "1953-default", 1953)); // was ~5
    MID(scoreMetric("exportDependency", 18, "JP", "1953-default", 1953)); // was 100
    MID(scoreMetric("exportDependency", 10, "US", "1953-default", 1953)); // was 100
    MID(scoreMetric("crimeRate", 1750, "US", "1953-default", 1953)); // was ~97
    MID(scoreMetric("incomeInequality", 22, "US", "1953-default", 1953)); // was 100
    // waterQuality mid tier (78 of the 60-92 seed ladder); was 27 → top tiers pinned
    MID(scoreMetric("waterQuality", 78, "US", "1953-default", 1953));
  });

  it("1979 seed normals score mid-band", () => {
    MID(scoreMetric("educationSpending", 2200, "US", "1979-default", 1979));
    MID(scoreMetric("uninsuredRate", 13, "US", "1979-default", 1979));
    MID(scoreMetric("uninsuredRate", 55, "BR", "1979-default", 1979));
    MID(scoreMetric("uninsuredRate", 40, "CN", "1979-default", 1979));
    MID(scoreMetric("crimeRate", 5300, "US", "1979-default", 1979));
    MID(scoreMetric("rdIntensity", 1.3, "US", "1979-default", 1979));
    MID(scoreMetric("exportDependency", 25, "DE", "1979-default", 1979));
  });

  it("scores respond in BOTH directions in a 1953 context", () => {
    const cases: Array<[string, string, number, number]> = [
      // [metricId, countryId, seedNormal, improvedRaw]
      ["educationSpending", "US", 350, 480],
      ["uninsuredRate", "US", 38, 28], // lower is better
      ["crimeRate", "US", 1750, 1200], // lower is better
      ["rdIntensity", "US", 0.7, 1.1],
      ["waterQuality", "US", 70, 85],
      ["exportDependency", "JP", 18, 12], // lower is better
      ["incomeInequality", "US", 22, 17], // lower is better
    ];
    for (const [id, c, seed, better] of cases) {
      const at = (v: number) => scoreMetric(id, v, c, "1953-default", 1953)!;
      const worse = seed + (seed - better); // symmetric decline
      expect(at(better), `${id} improvement`).toBeGreaterThan(at(seed));
      expect(at(worse), `${id} decline`).toBeLessThan(at(seed));
      // and neither seed nor the moved values sit on a bound
      expect(at(seed)).toBeGreaterThan(0);
      expect(at(seed)).toBeLessThan(100);
    }
  });

  it("2019 is byte-identical: every touched metric's flag-on band at year ≥ 2019 equals the static THRESHOLDS", () => {
    const touched: Array<[string, string[]]> = [
      ["educationSpending", ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"]],
      ["uninsuredRate", ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"]],
      ["crimeRate", ["US", "UK", "JP"]],
      ["waterQuality", ["US", "UK", "DE"]],
      ["rdIntensity", ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"]],
      ["exportDependency", ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"]],
      ["incomeInequality", ["US", "BR", "NG"]],
    ];
    for (const [id, countries] of touched) {
      for (const c of countries) {
        for (const y of [2019, 2030, 2045]) {
          expect(getMetricThreshold(id, c, "2019-default", y), `${id}/${c}@${y}`).toEqual(
            THRESHOLDS[id]
          );
        }
        // flag off (year null) unchanged too
        expect(getMetricThreshold(id, c, "2019-default", null), `${id}/${c} flag-off`).toEqual(
          THRESHOLDS[id]
        );
      }
    }
    // incomeInequality pre-existing non-1953 anchors untouched
    expect(getMetricThreshold("incomeInequality", "US", "1979-default", 1979)).toEqual({
      best: 23,
      worst: 48,
    });
    expect(getMetricThreshold("incomeInequality", "US", "1991-default", 1991)).toEqual({
      best: 24,
      worst: 52,
    });
  });
});
