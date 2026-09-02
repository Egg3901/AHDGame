import { describe, expect, it } from "vitest";
import { ORG_BUILD_MIN_FUNDED_FRACTION, ORG_BUILD_TREASURY_FRACTION } from "./strengthConstants";
import { clampFundedFraction, orgBuildCashPrice, resolveOrgBuildFunding } from "./buildOrgFunding";

// Treasury cost for the Build Org action. Price is country-normalized off
// TREASURY_PS_RATE_BY_COUNTRY and scales with the EFFECTIVE PS cost, so the
// pressure ladder bites in cash as well as in PS.

describe("orgBuildCashPrice", () => {
  it("prices a state-scope click off the country's state rate", () => {
    // US state rate 37,500 × 0.075 = 2,812.50 per PS.
    expect(orgBuildCashPrice("US", "state", 1)).toBeCloseTo(
      37_500 * ORG_BUILD_TREASURY_FRACTION,
      6
    );
  });

  it("prices a national-targeted click off the country's national rate", () => {
    expect(orgBuildCashPrice("US", "national-targeted", 1)).toBeCloseTo(
      75_000 * ORG_BUILD_TREASURY_FRACTION,
      6
    );
  });

  it("scales linearly with the effective PS cost so the pressure ladder bites in cash", () => {
    const atOne = orgBuildCashPrice("US", "state", 1);
    expect(orgBuildCashPrice("US", "state", 8)).toBeCloseTo(atOne * 8, 6);
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
