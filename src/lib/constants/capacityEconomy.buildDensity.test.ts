import { describe, it, expect } from "vitest";
import { CAPACITY_ANCHOR_YEAR, computeBuildCost } from "./capacityEconomy";
import {
  DOMINANCE_DENSITY_CROWDED_COMPETITORS,
  DOMINANCE_DENSITY_MIN_FACTOR,
  DOMINANCE_MARKET_SHARE_THRESHOLD,
  dominanceDensityFactor,
  getDominanceGrowthCostMultiplier,
} from "./corporations";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

/**
 * Suggestion #30: the dominance build toll scales with how contested the market
 * is. 60% of a two-firm state is not the same achievement as 60% of a five-firm
 * state, and pricing them alike left thin markets unbuilt while demand went
 * unserved.
 *
 * The toll is the WHOLE dominance charge under plants (see the block comment on
 * `computeBuildCost`), so these numbers are what a player actually pays.
 */

const BASE = {
  eraUnitScale: 1,
  sectorType: "manufacturing" as const,
  units: 1_000,
  year: CAPACITY_ANCHOR_YEAR,
  primeRate: 0,
  acumen: NEUTRAL_STAT,
};

describe("dominanceDensityFactor", () => {
  it("is the floor with no rivals and 1 once the market is crowded", () => {
    expect(dominanceDensityFactor(0)).toBe(DOMINANCE_DENSITY_MIN_FACTOR);
    expect(dominanceDensityFactor(DOMINANCE_DENSITY_CROWDED_COMPETITORS)).toBe(1);
  });

  it("saturates rather than discounting past the crowded threshold", () => {
    expect(dominanceDensityFactor(DOMINANCE_DENSITY_CROWDED_COMPETITORS + 50)).toBe(1);
  });

  it("rises monotonically between the two ends", () => {
    const seen = Array.from({ length: DOMINANCE_DENSITY_CROWDED_COMPETITORS + 1 }, (_, n) =>
      dominanceDensityFactor(n)
    );
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it("fails toward the FULL toll when density is unknown", () => {
    // A DB hiccup must never silently discount expansion.
    expect(dominanceDensityFactor(null)).toBe(1);
    expect(dominanceDensityFactor(undefined)).toBe(1);
    expect(dominanceDensityFactor(NaN)).toBe(1);
    expect(dominanceDensityFactor(-3)).toBe(1);
  });
});

describe("computeBuildCost density scaling", () => {
  const dominantShare = DOMINANCE_MARKET_SHARE_THRESHOLD + 25;

  it("charges a sole occupant less than a corp that fought for the same share", () => {
    const alone = computeBuildCost({
      ...BASE,
      marketSharePercent: dominantShare,
      competitorCount: 0,
    });
    const crowded = computeBuildCost({
      ...BASE,
      marketSharePercent: dominantShare,
      competitorCount: DOMINANCE_DENSITY_CROWDED_COMPETITORS,
    });
    expect(alone.totalAnchor).toBeLessThan(crowded.totalAnchor);
  });

  it("still charges a sole occupant a real premium — the toll is damped, not removed", () => {
    const alone = computeBuildCost({
      ...BASE,
      marketSharePercent: dominantShare,
      competitorCount: 0,
    });
    const undominant = computeBuildCost({ ...BASE, marketSharePercent: 0, competitorCount: 0 });
    expect(alone.totalAnchor).toBeGreaterThan(undominant.totalAnchor);
  });

  it("scales the toll's excess over 1, hand-computed", () => {
    const raw = getDominanceGrowthCostMultiplier(dominantShare);
    const quote = computeBuildCost({
      ...BASE,
      marketSharePercent: dominantShare,
      competitorCount: 1,
    });
    const expected = 1 + (raw - 1) * dominanceDensityFactor(1);
    expect(quote.dominanceMultiplier).toBeCloseTo(expected, 10);
  });

  it("leaves a sub-threshold sector untouched at every density", () => {
    // Below the threshold the toll is already 1.0×; density must not create a
    // discount out of nothing, or building becomes cheapest where nobody is.
    for (const competitorCount of [0, 1, 2, 9]) {
      const quote = computeBuildCost({
        ...BASE,
        marketSharePercent: DOMINANCE_MARKET_SHARE_THRESHOLD,
        competitorCount,
      });
      expect(quote.dominanceMultiplier).toBe(1);
    }
  });

  it("prices at the full toll when the caller omits density", () => {
    // Back-compat: every pre-existing call site passes no competitorCount and
    // must keep paying exactly what it paid before.
    const omitted = computeBuildCost({ ...BASE, marketSharePercent: dominantShare });
    expect(omitted.dominanceMultiplier).toBe(getDominanceGrowthCostMultiplier(dominantShare));
  });
});
