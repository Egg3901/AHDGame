import { describe, expect, it } from "vitest";
import { computeFoundingCosts, getFoundingFxRate } from "./foundingCosts";
import { CORPORATION_FOUNDING_COST, CORPORATION_STARTING_CAPITAL } from "../constants/corporations";

describe("computeFoundingCosts", () => {
  it("charges the founder the same local amount the corp is seeded with (USD baseline)", () => {
    const r = computeFoundingCosts({
      startingCapitalAnchor: CORPORATION_STARTING_CAPITAL,
      foundingRate: 1.0,
    });
    expect(r.corpStartingCapital).toBe(CORPORATION_STARTING_CAPITAL);
    // Founding fee == baseline capital, so the founder pays exactly the seed.
    expect(r.totalPlayerCost).toBe(CORPORATION_STARTING_CAPITAL);
  });

  it("scales BOTH the corp seed and the founder charge by the FX rate (CN 7.2x)", () => {
    // 24M ₳ requested in a CN corp (initial rate 7.2). Regression for the
    // money-laundering exploit: founder was charged 24M CNY while the corp was
    // seeded 172.8M CNY — a 7.2x mint. Both must now be 172.8M CNY.
    const r = computeFoundingCosts({
      startingCapitalAnchor: 24_000_000,
      foundingRate: 7.2,
    });
    expect(r.corpStartingCapital).toBe(172_800_000);
    expect(r.totalPlayerCost).toBe(172_800_000);
  });

  it("never mints: founder charge >= corp seed for any rate and capital", () => {
    for (const rate of [0.75, 0.92, 1.0, 5.0, 7.2, 106.0, 1550.0]) {
      for (const capAnchor of [1_000_000, 5_000_000, 24_000_000, 50_000_000]) {
        const r = computeFoundingCosts({
          startingCapitalAnchor: capAnchor,
          foundingRate: rate,
        });
        expect(r.totalPlayerCost).toBeGreaterThanOrEqual(r.corpStartingCapital);
      }
    }
  });

  it("charges founding fee + extra commitment, both converted to local (JP 106x)", () => {
    const extraAnchor = 10_000_000;
    const startingCapitalAnchor = CORPORATION_STARTING_CAPITAL + extraAnchor;
    const r = computeFoundingCosts({ startingCapitalAnchor, foundingRate: 106.0 });
    // founder pays (foundingFee + extra) * rate in local
    expect(r.totalPlayerCost).toBe(Math.round((CORPORATION_FOUNDING_COST + extraAnchor) * 106.0));
    expect(r.corpStartingCapital).toBe(Math.round(startingCapitalAnchor * 106.0));
    expect(r.extraCapitalOverBaselineAnchor).toBe(extraAnchor);
  });

  it("charges no confidence premium at the default multiplier", () => {
    const r = computeFoundingCosts({
      startingCapitalAnchor: CORPORATION_STARTING_CAPITAL,
      foundingRate: 1.0,
    });
    expect(r.confidencePremiumLocal).toBe(0);
    expect(r.totalPlayerCost).toBe(CORPORATION_STARTING_CAPITAL);
  });

  it("adds a treasury-bound confidence premium without shrinking the corp seed", () => {
    const r = computeFoundingCosts({
      startingCapitalAnchor: CORPORATION_STARTING_CAPITAL,
      foundingRate: 1.0,
      confidenceMultiplier: 1.2,
    });
    // Seed unchanged.
    expect(r.corpStartingCapital).toBe(CORPORATION_STARTING_CAPITAL);
    // Premium = fee × (mult − 1) × rate.
    expect(r.confidencePremiumLocal).toBe(Math.round(CORPORATION_FOUNDING_COST * 0.2));
    // Conservation: founder charge == corp seed + treasury premium (baseline founding).
    expect(r.totalPlayerCost).toBe(r.corpStartingCapital + r.confidencePremiumLocal);
  });
});

describe("getFoundingFxRate", () => {
  it("returns the country's INITIAL_RATE for a non-USD country when forex is on", () => {
    expect(getFoundingFxRate("CN", true)).toBe(7.2);
    expect(getFoundingFxRate("JP", true)).toBe(106.0);
  });

  it("returns 1 for USD countries even when forex is on", () => {
    expect(getFoundingFxRate("US", true)).toBe(1);
  });

  it("returns 1 when forex is disabled regardless of country", () => {
    expect(getFoundingFxRate("CN", false)).toBe(1);
    expect(getFoundingFxRate("JP", false)).toBe(1);
  });

  it("returns 1 when the country is unknown/null (rate not yet loaded)", () => {
    expect(getFoundingFxRate(null, true)).toBe(1);
    expect(getFoundingFxRate(undefined, true)).toBe(1);
  });
});
