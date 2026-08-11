/**
 * Starting cash and corporation founding costs must move TOGETHER.
 *
 * Deflating starting cash alone makes founding impossible in a 1953 world:
 * a high-income character would hold ~72,000 against an unscaled 2,000,000
 * floor (fee plus minimum capital). The test that matters here is not that
 * either one scales — it is that a character can still afford to found.
 */
import { describe, expect, it } from "vitest";
import {
  CORPORATION_FOUNDING_COST,
  CORPORATION_STARTING_CAPITAL,
  MIN_CORPORATION_STARTING_CAPITAL,
  MAX_CORPORATION_STARTING_CAPITAL,
} from "./corporations";
import { WEALTH_BONUS, getWealthBonus } from "./characterWealth";
import { CEO_INITIAL_SHARES, MIN_SHARE_PRICE, DEFAULT_SHARE_PRICE } from "./corporations";
import { getEraFoundingBounds, getEraFounderShares, getEraNominalAmount } from "./sectorSeedEra";
import { computeFoundingCosts } from "@/lib/corporations/foundingCosts";

const MODERN = {
  fee: CORPORATION_FOUNDING_COST,
  baseline: CORPORATION_STARTING_CAPITAL,
  min: MIN_CORPORATION_STARTING_CAPITAL,
  max: MAX_CORPORATION_STARTING_CAPITAL,
};

/** Cheapest possible founding: the fee plus the minimum capital commitment. */
function cheapestFounding(preset?: string): number {
  const b = getEraFoundingBounds(preset, MODERN);
  const { totalPlayerCost } = computeFoundingCosts({
    startingCapitalAnchor: b.min,
    foundingRate: 1,
    preset,
  });
  return totalPlayerCost;
}

describe("era money scale — cash and founding move together", () => {
  it("a high-income character can still found a corporation in 1953", () => {
    // The regression this whole pairing exists to prevent.
    expect(getWealthBonus("high", "1953-default")).toBeGreaterThanOrEqual(
      cheapestFounding("1953-default")
    );
  });

  it("a MIDDLE-income character can found a corporation in every era", () => {
    // Owner requirement: middle and high income must be able to found at any
    // time. Low income is deliberately borderline (it equals the floor).
    for (const preset of ["1953-default", "1979-default", "1991-default", "2019-default"]) {
      expect(getWealthBonus("middle", preset)).toBeGreaterThanOrEqual(cheapestFounding(preset));
      expect(getWealthBonus("high", preset)).toBeGreaterThanOrEqual(cheapestFounding(preset));
    }
  });

  it("the era minimum is what a founder actually commits at the floor", () => {
    // The schema must not impose a modern floor on top of these: the 1953
    // minimum is ~1/70th of the modern one, and the request path rejected it.
    const b = getEraFoundingBounds("1953-default", MODERN);
    expect(b.min).toBeLessThan(MODERN.min);
    expect(cheapestFounding("1953-default")).toBe(b.fee);
  });

  it("reports no NEGATIVE extra treasury when founding at the era baseline", () => {
    // The founding modal omitted the preset, so it compared an era treasury
    // against the MODERN baseline and displayed a large negative "extra
    // treasury" (14,333 - 1,000,000). Totals cancelled; line items did not.
    const b = getEraFoundingBounds("1953-default", MODERN);
    const { extraCapitalOverBaselineAnchor, totalPlayerCost } = computeFoundingCosts({
      startingCapitalAnchor: b.baseline,
      foundingRate: 1,
      preset: "1953-default",
    });
    expect(extraCapitalOverBaselineAnchor).toBe(0);
    expect(totalPlayerCost).toBe(b.fee);
  });

  it("keeps the modern affordability relationship unchanged", () => {
    const modernAffordable = WEALTH_BONUS.high >= cheapestFounding("2019-default");
    expect(modernAffordable).toBe(true);
    // And 1953 is no HARDER than modern, proportionally.
    const ratio1953 = getWealthBonus("high", "1953-default") / cheapestFounding("1953-default");
    const ratioModern = WEALTH_BONUS.high / cheapestFounding("2019-default");
    expect(ratio1953).toBeGreaterThan(ratioModern * 0.5);
  });

  it("is a strict no-op for every modern preset and alias", () => {
    for (const preset of [
      "2019-default",
      "2023-default",
      "1991-default",
      "1979-default",
      "empty",
      "unknown-preset",
      undefined,
    ]) {
      expect(getWealthBonus("low", preset)).toBe(WEALTH_BONUS.low);
      expect(getEraFoundingBounds(preset, MODERN)).toEqual(MODERN);
      expect(
        computeFoundingCosts({ startingCapitalAnchor: MODERN.baseline, foundingRate: 1, preset })
      ).toEqual(computeFoundingCosts({ startingCapitalAnchor: MODERN.baseline, foundingRate: 1 }));
    }
  });

  it("deflates every founding number by the same shared scale", () => {
    const b = getEraFoundingBounds("1953-default", MODERN);
    expect(b.fee).toBe(getEraNominalAmount(MODERN.fee, "1953-default"));
    expect(b.baseline).toBe(getEraNominalAmount(MODERN.baseline, "1953-default"));
    expect(b.min).toBe(getEraNominalAmount(MODERN.min, "1953-default"));
    expect(b.max).toBe(getEraNominalAmount(MODERN.max, "1953-default"));
  });

  it("preserves the min < baseline <= max ordering", () => {
    for (const preset of ["1953-default", "2019-default"]) {
      const b = getEraFoundingBounds(preset, MODERN);
      expect(b.min).toBeLessThanOrEqual(b.baseline);
      expect(b.baseline).toBeLessThanOrEqual(b.max);
      expect(b.fee).toBeGreaterThan(0);
    }
  });

  it("keeps the wealth tiers ordered and proportional after deflation", () => {
    const low = getWealthBonus("low", "1953-default");
    const mid = getWealthBonus("middle", "1953-default");
    const high = getWealthBonus("high", "1953-default");
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(mid / low).toBeCloseTo(WEALTH_BONUS.middle / WEALTH_BONUS.low, 1);
  });

  it("never grants or charges zero", () => {
    expect(getWealthBonus("low", "1953-default")).toBeGreaterThan(0);
    expect(cheapestFounding("1953-default")).toBeGreaterThan(0);
  });
});

/** Opening price exactly as every mint site computes it. */
function openingSharePrice(treasury: number, shares: number): number {
  return Math.max(MIN_SHARE_PRICE, Math.round((treasury / shares) * 100) / 100);
}

describe("era share base — market cap at founding equals the treasury", () => {
  const PRESETS = ["1953-default", "1979-default", "1991-default", "2019-default"];

  it("never floors the opening price at the era baseline", () => {
    // The bug: 14,333 over a fixed 10,000,000 shares prices at 0.0014, floors
    // at MIN_SHARE_PRICE, and opens the corp at ~7x its own treasury.
    for (const preset of PRESETS) {
      const b = getEraFoundingBounds(preset, MODERN);
      const shares = getEraFounderShares(CEO_INITIAL_SHARES, preset);
      const price = openingSharePrice(b.baseline, shares);
      expect(price).toBeGreaterThan(MIN_SHARE_PRICE);
      expect(price).toBeCloseTo(DEFAULT_SHARE_PRICE, 2);
    }
  });

  it("opens at a market cap within 1% of the treasury, in every era", () => {
    for (const preset of PRESETS) {
      const b = getEraFoundingBounds(preset, MODERN);
      const shares = getEraFounderShares(CEO_INITIAL_SHARES, preset);
      const marketCap = openingSharePrice(b.baseline, shares) * shares;
      expect(Math.abs(marketCap - b.baseline) / b.baseline).toBeLessThan(0.01);
    }
  });

  it("regression: the OLD fixed share base inflated a 1953 opening ~7x", () => {
    const b = getEraFoundingBounds("1953-default", MODERN);
    const oldCap = openingSharePrice(b.baseline, CEO_INITIAL_SHARES) * CEO_INITIAL_SHARES;
    expect(oldCap / b.baseline).toBeGreaterThan(5);
    const newShares = getEraFounderShares(CEO_INITIAL_SHARES, "1953-default");
    const newCap = openingSharePrice(b.baseline, newShares) * newShares;
    expect(newCap / b.baseline).toBeCloseTo(1, 1);
  });

  it("holds across the whole era range, not just the baseline", () => {
    const preset = "1953-default";
    const b = getEraFoundingBounds(preset, MODERN);
    const shares = getEraFounderShares(CEO_INITIAL_SHARES, preset);
    for (const treasury of [b.min, b.baseline, Math.round(b.max / 2), b.max]) {
      const cap = openingSharePrice(treasury, shares) * shares;
      expect(Math.abs(cap - treasury) / treasury).toBeLessThan(0.02);
    }
  });

  it("is a strict no-op for modern presets and absent preset", () => {
    for (const preset of ["2019-default", "2023-default", "unknown", undefined]) {
      expect(getEraFounderShares(CEO_INITIAL_SHARES, preset)).toBe(CEO_INITIAL_SHARES);
    }
  });

  it("keeps the share base a positive whole number", () => {
    for (const preset of PRESETS) {
      const shares = getEraFounderShares(CEO_INITIAL_SHARES, preset);
      expect(Number.isInteger(shares)).toBe(true);
      expect(shares).toBeGreaterThan(0);
    }
  });
});
