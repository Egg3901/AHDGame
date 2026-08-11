import { describe, expect, it } from "vitest";
import { legacyValueFromPoliticalScore, politicalScoreFromLegacyValue } from "./legacyInversion";

describe("politicalScoreFromLegacyValue", () => {
  it("maps a higher-is-better metric at its best to ~100 and worst to ~0", () => {
    const best = politicalScoreFromLegacyValue("education", "literacyRate", 100)!;
    const worst = politicalScoreFromLegacyValue("education", "literacyRate", 0)!;
    expect(best).toBeGreaterThan(worst);
    expect(best).toBeLessThanOrEqual(100);
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it("INVERTS a lower-is-better metric — high crime must score LOW", () => {
    // The single most important property: legacy polarity varies per metric and
    // a sign error here would silently invert a country's whole board.
    const lowCrime = politicalScoreFromLegacyValue("publicSafety", "crimeRate", 100)!;
    const highCrime = politicalScoreFromLegacyValue("publicSafety", "crimeRate", 10_000)!;
    expect(lowCrime).toBeGreaterThan(highCrime);
  });

  it("clamps into 0-100 for absurd inputs", () => {
    const v = politicalScoreFromLegacyValue("education", "literacyRate", 1e9)!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("returns null for a metric with no definition", () => {
    expect(politicalScoreFromLegacyValue("education", "notARealMetric", 50)).toBeNull();
  });

  it("never returns NaN for any real metric", () => {
    for (const [category, metricId] of [
      ["healthcare", "lifeExpectancy"],
      ["education", "testPerformance"],
      ["infrastructure", "roadCondition"],
      ["environment", "airQuality"],
    ] as const) {
      const v = politicalScoreFromLegacyValue(category, metricId, 50);
      expect(v === null || Number.isFinite(v), `${category}.${metricId}`).toBe(true);
    }
  });
});

describe("legacyValueFromPoliticalScore", () => {
  it("round-trips any value inside the realistic range", () => {
    // The property that makes this safe to use as a read adapter: it is the
    // exact inverse of the forward derivation, over the same span.
    const cases: Array<[string, string, number]> = [
      ["infrastructure", "powerGridReliability", 98.5],
      ["environment", "renewableEnergy", 35],
      ["environment", "carbonEmissions", 12], // tCO2/capita: realistic span is 3-25
      ["education", "literacyRate", 92],
      ["publicSafety", "crimeRate", 3000],
      ["governance", "corruptionIndex", 40],
    ];
    for (const [category, metricId, value] of cases) {
      const score = politicalScoreFromLegacyValue(category, metricId, value);
      expect(score, `${category}.${metricId} score`).not.toBeNull();
      const back = legacyValueFromPoliticalScore(category, metricId, score!);
      expect(back, `${category}.${metricId} back`).not.toBeNull();
      expect(back!, `${category}.${metricId}`).toBeCloseTo(value, 6);
    }
  });

  it("honours polarity — a high score is a LOW value for lower-is-better metrics", () => {
    const goodCrime = legacyValueFromPoliticalScore("publicSafety", "crimeRate", 90)!;
    const badCrime = legacyValueFromPoliticalScore("publicSafety", "crimeRate", 10)!;
    expect(goodCrime).toBeLessThan(badCrime);
    const goodLiteracy = legacyValueFromPoliticalScore("education", "literacyRate", 90)!;
    const badLiteracy = legacyValueFromPoliticalScore("education", "literacyRate", 10)!;
    expect(goodLiteracy).toBeGreaterThan(badLiteracy);
  });

  it("lands on the midpoint of the realistic range at a neutral score", () => {
    // Deliberately NOT the consumer-neutral parity of Bridge A's bands — see
    // the docstring. Pinned so the two adapters cannot be confused for each other.
    const mid = legacyValueFromPoliticalScore("infrastructure", "powerGridReliability", 50)!;
    const best = legacyValueFromPoliticalScore("infrastructure", "powerGridReliability", 100)!;
    const worst = legacyValueFromPoliticalScore("infrastructure", "powerGridReliability", 0)!;
    expect(mid).toBeCloseTo((best + worst) / 2, 6);
  });

  it("returns null rather than guessing for medianIncome and unknown metrics", () => {
    expect(legacyValueFromPoliticalScore("economic", "medianIncome", 60)).toBeNull();
    expect(legacyValueFromPoliticalScore("economic", "notAMetric", 60)).toBeNull();
    expect(legacyValueFromPoliticalScore("education", "literacyRate", Number.NaN)).toBeNull();
  });
});
