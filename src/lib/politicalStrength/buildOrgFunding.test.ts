import { describe, expect, it } from "vitest";
import {
  ORG_BUILD_MIN_FUNDED_FRACTION,
  ORG_BUILD_SIZE_MULTIPLIER_MAX,
  ORG_BUILD_SIZE_MULTIPLIER_MIN,
  ORG_BUILD_TREASURY_FRACTION,
} from "./strengthConstants";
import {
  clampFundedFraction,
  orgBuildCashPrice,
  orgBuildSizeMultiplier,
  resolveOrgBuildFunding,
} from "./buildOrgFunding";

// Treasury cost for the Build Org action. Price is country-normalized off
// TREASURY_PS_RATE_BY_COUNTRY and scales with the EFFECTIVE PS cost, so the
// pressure ladder bites in cash as well as in PS.

describe("orgBuildCashPrice", () => {
  it("prices a state-scope click off the country's state rate", () => {
    // US state rate 37,500 × 0.075, to whole currency units.
    expect(orgBuildCashPrice("US", "state", 1)).toBe(
      Math.round(37_500 * ORG_BUILD_TREASURY_FRACTION)
    );
  });

  it("prices a national-targeted click off the country's national rate", () => {
    expect(orgBuildCashPrice("US", "national-targeted", 1)).toBeCloseTo(
      75_000 * ORG_BUILD_TREASURY_FRACTION,
      6
    );
  });

  it("scales with the effective PS cost so the pressure ladder bites in cash", () => {
    // Rounded once from the exact product, so a ladder-capped click costs ~8× a
    // fresh one (not exactly 8× the rounded single-PS price).
    expect(orgBuildCashPrice("US", "state", 8)).toBe(
      Math.round(37_500 * ORG_BUILD_TREASURY_FRACTION * 8)
    );
    expect(orgBuildCashPrice("US", "state", 8)).toBeGreaterThan(
      orgBuildCashPrice("US", "state", 1) * 7
    );
  });

  it("normalizes across currencies rather than using one flat number", () => {
    // UK trades in sterling at a lower rate; JP in yen at a far higher one.
    expect(orgBuildCashPrice("UK", "national-targeted", 1)).toBeCloseTo(
      60_000 * ORG_BUILD_TREASURY_FRACTION,
      6
    );
    expect(orgBuildCashPrice("JP", "national-targeted", 1)).toBeCloseTo(
      5_000_000 * ORG_BUILD_TREASURY_FRACTION,
      6
    );
  });

  it("treats a pure-national spend as the national rate", () => {
    expect(orgBuildCashPrice("US", "national", 1)).toBeCloseTo(
      orgBuildCashPrice("US", "national-targeted", 1),
      6
    );
  });

  it("returns 0 for a non-positive PS cost", () => {
    expect(orgBuildCashPrice("US", "state", 0)).toBe(0);
    expect(orgBuildCashPrice("US", "state", -3)).toBe(0);
  });

  it("prices in whole currency units", () => {
    // 37,500 × 0.075 = 2,812.5 — a half-unit charge would leave floating-point
    // tails in every treasury it touches and make the quoted price and the
    // charged amount compare inexactly.
    expect(orgBuildCashPrice("US", "state", 1)).toBe(2813);
    expect(Number.isInteger(orgBuildCashPrice("US", "state", 3))).toBe(true);
    expect(Number.isInteger(orgBuildCashPrice("UK", "national-targeted", 7))).toBe(true);
  });
});

// Org is consumed as a normalized SHARE within its state, so a point of Org in
// a 20.8M state carries ~64x the electoral weight of a point in a 326k one. A
// flat price underwrites exactly the states worth winning, so the price scales
// with the square root of population, normalized so the country average is 1.
describe("orgBuildSizeMultiplier", () => {
  it("is 1 for a state of exactly the country's normalizing size", () => {
    expect(orgBuildSizeMultiplier(4_000_000, 2000)).toBeCloseTo(1, 6);
  });

  it("charges more in a larger state and less in a smaller one", () => {
    // Normalizer 2000 = sqrt(4,000,000): a 16M state is 2x, a 1M state 0.5x.
    expect(orgBuildSizeMultiplier(16_000_000, 2000)).toBeCloseTo(2, 6);
    expect(orgBuildSizeMultiplier(1_000_000, 2000)).toBeCloseTo(0.5, 6);
  });

  it("compresses the spread with a square root rather than scaling linearly", () => {
    // Four times the population is TWICE the price, not four times. Linear
    // pricing on the live US spread would put Alaska near free.
    const base = orgBuildSizeMultiplier(4_000_000, 2000);
    const fourFold = orgBuildSizeMultiplier(16_000_000, 2000);
    expect(fourFold / base).toBeCloseTo(2, 6);
  });

  it("clamps to the agreed band so no state is free or ruinous", () => {
    expect(orgBuildSizeMultiplier(1_000_000_000, 2000)).toBe(ORG_BUILD_SIZE_MULTIPLIER_MAX);
    expect(orgBuildSizeMultiplier(1, 2000)).toBe(ORG_BUILD_SIZE_MULTIPLIER_MIN);
  });

  it("falls back to a neutral 1 when the size inputs are unusable", () => {
    // A world with no demographics seeded must price exactly as it does today.
    expect(orgBuildSizeMultiplier(0, 2000)).toBe(1);
    expect(orgBuildSizeMultiplier(4_000_000, 0)).toBe(1);
    expect(orgBuildSizeMultiplier(Number.NaN, 2000)).toBe(1);
    expect(orgBuildSizeMultiplier(undefined, 2000)).toBe(1);
  });
});

describe("orgBuildCashPrice with a size multiplier", () => {
  it("defaults to the unscaled price when no multiplier is given", () => {
    expect(orgBuildCashPrice("US", "state", 1)).toBe(Math.round(37_500 * 0.075));
  });

  it("scales the price by the multiplier, still in whole units", () => {
    // Rounded once from the exact product, so these are round(2812.5 x m) and
    // not the rounded flat price multiplied again.
    expect(orgBuildCashPrice("US", "state", 1, 2)).toBe(Math.round(37_500 * 0.075 * 2));
    expect(orgBuildCashPrice("US", "state", 1, 0.5)).toBe(Math.round(37_500 * 0.075 * 0.5));
  });

  it("ignores an unusable multiplier rather than zeroing the price", () => {
    const flat = orgBuildCashPrice("US", "state", 1);
    expect(orgBuildCashPrice("US", "state", 1, 0)).toBe(flat);
    expect(orgBuildCashPrice("US", "state", 1, Number.NaN)).toBe(flat);
    expect(orgBuildCashPrice("US", "state", 1, -3)).toBe(flat);
  });
});

describe("resolveOrgBuildFunding", () => {
  it("charges the full price and funds the click fully when the treasury covers it", () => {
    const funding = resolveOrgBuildFunding({ price: 10_000, treasury: 50_000 });
    expect(funding.ok).toBe(true);
    if (!funding.ok) return;
    expect(funding.paid).toBe(10_000);
    expect(funding.fundedFraction).toBe(1);
  });

  it("charges what is there and shrinks the click when the treasury falls short", () => {
    // Half the price on hand → half the Org.
    const funding = resolveOrgBuildFunding({ price: 10_000, treasury: 5_000 });
    expect(funding.ok).toBe(true);
    if (!funding.ok) return;
    expect(funding.paid).toBe(5_000);
    expect(funding.fundedFraction).toBeCloseTo(0.5, 6);
  });

  it("refuses below the minimum funded fraction rather than selling a near-worthless click", () => {
    const funding = resolveOrgBuildFunding({ price: 10_000, treasury: 2_000 });
    expect(funding.ok).toBe(false);
    if (funding.ok) return;
    expect(funding.reason).toBe("insufficient-funds");
    expect(funding.price).toBe(10_000);
    expect(funding.treasury).toBe(2_000);
  });

  it("funds a click sitting exactly on the minimum fraction", () => {
    const funding = resolveOrgBuildFunding({
      price: 10_000,
      treasury: 10_000 * ORG_BUILD_MIN_FUNDED_FRACTION,
    });
    expect(funding.ok).toBe(true);
    if (!funding.ok) return;
    expect(funding.fundedFraction).toBeCloseTo(ORG_BUILD_MIN_FUNDED_FRACTION, 6);
  });

  it("refuses an empty or overdrawn treasury", () => {
    expect(resolveOrgBuildFunding({ price: 10_000, treasury: 0 }).ok).toBe(false);
    expect(resolveOrgBuildFunding({ price: 10_000, treasury: -50_000 }).ok).toBe(false);
  });

  it("funds the click for free when the price is zero", () => {
    const funding = resolveOrgBuildFunding({ price: 0, treasury: 0 });
    expect(funding.ok).toBe(true);
    if (!funding.ok) return;
    expect(funding.paid).toBe(0);
    expect(funding.fundedFraction).toBe(1);
  });
});

describe("clampFundedFraction", () => {
  it("floors a post-commit fraction so committed PS can never buy nothing", () => {
    // A concurrent debit drained the treasury after the PS was spent.
    expect(clampFundedFraction(0)).toBe(ORG_BUILD_MIN_FUNDED_FRACTION);
    expect(clampFundedFraction(-1)).toBe(ORG_BUILD_MIN_FUNDED_FRACTION);
  });

  it("caps at a fully funded click", () => {
    expect(clampFundedFraction(3)).toBe(1);
  });

  it("passes an in-range fraction through untouched", () => {
    expect(clampFundedFraction(0.5)).toBeCloseTo(0.5, 6);
  });
});
