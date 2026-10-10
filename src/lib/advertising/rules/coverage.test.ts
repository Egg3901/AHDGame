/**
 * Rules tests: supplier coverage, buyer weights, overlap, and efficacy.
 * Proves bounded outputs, footprint/technology effects, revenue weighting,
 * HQ fallback, inactive-sector exclusion, and flag-off-adjacent neutrality
 * (no models and no footprint yields zero coverage, hence a neutral factor).
 */
import { describe, expect, it } from "vitest";
import {
  AD_MAX_COVERAGE_BONUS,
  advertisingEfficacyFactor,
  buyerOperatingWeights,
  coverageOverlap,
  efficacyAdjustedAdvertising,
  efficacyFactorForOverlap,
  isSectorActiveForCoverage,
  nationalModelReach,
  operatingModelsFromSectors,
  supplierCoverageByState,
  technologyLift,
} from "./coverage";

describe("nationalModelReach", () => {
  it("is zero with no models", () => {
    expect(nationalModelReach([])).toBe(0);
    expect(nationalModelReach(undefined)).toBe(0);
  });

  it("uses a single model's reach", () => {
    expect(nationalModelReach(["broadcast_tv"])).toBeCloseTo(0.5, 10);
  });

  it("combines models with diminishing returns and stays bounded", () => {
    const two = nationalModelReach(["broadcast_tv", "streaming_platform"]);
    expect(two).toBeCloseTo(1 - 0.5 * 0.55, 10);
    expect(two).toBeLessThanOrEqual(1);
    const all = nationalModelReach([
      "broadcast_tv",
      "streaming_platform",
      "radio_network",
      "film_studio",
      "newspaper",
      "music_label",
      "live_entertainment",
      "publishing_house",
    ]);
    expect(all).toBeGreaterThan(two);
    expect(all).toBeLessThanOrEqual(1);
  });

  it("dedupes unknown models to zero contribution", () => {
    expect(nationalModelReach(["broadcast_tv", "broadcast_tv"])).toBeCloseTo(0.5, 10);
    expect(nationalModelReach(["not_a_model"])).toBe(0);
  });
});

describe("isSectorActiveForCoverage", () => {
  it("excludes mothballed, suspended, and zero-capacity sectors", () => {
    expect(isSectorActiveForCoverage({ mothballed: true })).toBe(false);
    expect(isSectorActiveForCoverage({ embargoSuspended: true })).toBe(false);
    expect(isSectorActiveForCoverage({ activeCapacityPercent: 0 })).toBe(false);
    expect(isSectorActiveForCoverage({})).toBe(true);
    expect(isSectorActiveForCoverage({ activeCapacityPercent: 50 })).toBe(true);
  });
});

describe("supplierCoverageByState", () => {
  it("boosts footprint states over non-footprint states", () => {
    const coverage = supplierCoverageByState({
      operatingModels: ["broadcast_tv"],
      supplierSectors: [
        { stateId: "US-CA", revenue: 1000 },
        { stateId: "US-CA", revenue: 500, mothballed: true },
      ],
      states: ["US-CA", "US-NY"],
    });
    expect(coverage.get("US-CA")).toBeGreaterThan(coverage.get("US-NY")!);
    expect(coverage.get("US-CA")).toBeLessThanOrEqual(1);
  });

  it("is zero everywhere with no models, footprint, or tech", () => {
    const coverage = supplierCoverageByState({
      operatingModels: [],
      supplierSectors: [],
      states: ["US-CA"],
    });
    expect(coverage.get("US-CA")).toBe(0);
  });

  it("adds bounded technology lift", () => {
    expect(technologyLift(0)).toBe(0);
    expect(technologyLift(3)).toBeCloseTo(0.06, 10);
    expect(technologyLift(100)).toBeLessThanOrEqual(0.1);
  });
});

describe("buyerOperatingWeights", () => {
  it("weights states by revenue and ignores inactive sectors", () => {
    const weights = buyerOperatingWeights({
      buyerSectors: [
        { stateId: "US-CA", revenue: 3000 },
        { stateId: "US-NY", revenue: 1000 },
        { stateId: "US-TX", revenue: 5000, mothballed: true },
      ],
    });
    expect(weights.get("US-CA")).toBeCloseTo(0.75, 4);
    expect(weights.get("US-NY")).toBeCloseTo(0.25, 4);
    expect(weights.has("US-TX")).toBe(false);
  });

  it("falls back to headquarters when no sector books revenue", () => {
    expect(
      buyerOperatingWeights({ buyerSectors: [], headquartersState: "US-CA" }).get("US-CA")
    ).toBe(1);
    expect(buyerOperatingWeights({ buyerSectors: [] }).size).toBe(0);
  });
});

describe("coverageOverlap and efficacy", () => {
  it("is full when the supplier covers every buyer state", () => {
    expect(
      coverageOverlap(
        new Map([
          ["US-CA", 0.5],
          ["US-NY", 0.5],
        ]),
        new Map([
          ["US-CA", 1],
          ["US-NY", 1],
        ])
      )
    ).toBe(1);
  });

  it("is zero for uncovered states and clamps hostile inputs", () => {
    expect(coverageOverlap(new Map([["US-CA", 1]]), new Map([["US-NY", 1]]))).toBe(0);
    expect(coverageOverlap(new Map(), new Map([["US-CA", 1]]))).toBe(0);
    expect(coverageOverlap(new Map([["US-CA", NaN]]), new Map([["US-CA", 1]]))).toBe(0);
  });

  it("bounds efficacy between neutral and the capped bonus", () => {
    expect(efficacyFactorForOverlap(0)).toBe(1);
    expect(efficacyFactorForOverlap(1)).toBe(1 + AD_MAX_COVERAGE_BONUS);
    expect(efficacyFactorForOverlap(0.5)).toBe(1 + AD_MAX_COVERAGE_BONUS / 2);
    expect(efficacyFactorForOverlap(-5)).toBe(1);
    expect(efficacyFactorForOverlap(99)).toBe(1 + AD_MAX_COVERAGE_BONUS);
    expect(efficacyFactorForOverlap(NaN)).toBe(1);
  });
});

describe("operatingModelsFromSectors", () => {
  it("returns resolved models run by active media sectors, once each", () => {
    const sector = (strategyId?: string, extra = {}) => ({
      stateId: "US-CA",
      revenue: 1,
      sectorType: "media",
      strategyId,
      ...extra,
    });
    expect(
      operatingModelsFromSectors(
        [
          sector(),
          sector(""),
          sector("standard"),
          sector("newspaper"),
          sector("broadcast_tv", { mothballed: true }),
          sector("legacy_broadcast"),
        ],
        1950
      )
    ).toEqual(["newspaper", "broadcast_tv"]);
  });

  it("uses radio before 1950 and ignores non-media or unavailable models", () => {
    expect(
      operatingModelsFromSectors(
        [
          { stateId: "US-CA", revenue: 1, sectorType: "media", strategyId: "legacy_broadcast" },
          { stateId: "US-CA", revenue: 1, sectorType: "manufacturing", strategyId: "newspaper" },
          { stateId: "US-CA", revenue: 1, sectorType: "media", strategyId: "streaming_platform" },
        ],
        1949
      )
    ).toEqual(["radio_network"]);
  });

  it("uses newspaper for a media sector with no stored strategy", () => {
    expect(
      operatingModelsFromSectors([{ stateId: "US-CA", revenue: 1, sectorType: "media" }], 1953)
    ).toEqual(["newspaper"]);
  });
});

describe("advertisingEfficacyFactor", () => {
  it("is the bounded effective over settled ratio", () => {
    expect(advertisingEfficacyFactor(100, 120)).toBe(1.2);
    expect(advertisingEfficacyFactor(100, 400)).toBe(1 + AD_MAX_COVERAGE_BONUS);
    expect(advertisingEfficacyFactor(100, 80)).toBe(1);
  });

  it("is neutral without spend or with bad input", () => {
    expect(advertisingEfficacyFactor(0, 50)).toBe(1);
    expect(advertisingEfficacyFactor(100, Number.NaN)).toBe(1);
  });
});

describe("efficacyAdjustedAdvertising", () => {
  it("scales paid advertising only when the settlement matches the receipt turn", () => {
    expect(efficacyAdjustedAdvertising(100, 7, { turn: 7, factor: 1.3 })).toBeCloseTo(130, 10);
    expect(efficacyAdjustedAdvertising(100, 8, { turn: 7, factor: 1.3 })).toBe(100);
    expect(efficacyAdjustedAdvertising(100, 7, undefined)).toBe(100);
  });

  it("never exceeds the coverage ceiling or drops below neutral", () => {
    expect(efficacyAdjustedAdvertising(100, 7, { turn: 7, factor: 9 })).toBe(
      100 * (1 + AD_MAX_COVERAGE_BONUS)
    );
    expect(efficacyAdjustedAdvertising(100, 7, { turn: 7, factor: 0.2 })).toBe(100);
  });
});
