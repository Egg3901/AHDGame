import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_BUY_CAP,
  OPPORTUNITY_SELL_CAP,
  bondBuyOpportunity,
  stockBuyOpportunity,
  stockSellOpportunity,
  volumeNormalizedMultipliers,
} from "./opportunityInvesting";

function expected(p: readonly number[], m: readonly number[]): number {
  return p.reduce((sum, pi, i) => sum + pi * m[i], 0);
}

describe("opportunity scores", () => {
  it("scores a stock edge over the NPP's value floor, 1 at the floor", () => {
    expect(stockBuyOpportunity(0.8, 0.8)).toBeCloseTo(1);
    expect(stockBuyOpportunity(1.2, 1.0)).toBeCloseTo(1.44);
    expect(stockBuyOpportunity(1.5, 0.75)).toBeGreaterThan(stockBuyOpportunity(1.2, 1.0));
  });

  it("scores a bond by yield over the floor, damped", () => {
    expect(bondBuyOpportunity(1, 1)).toBeCloseTo(1);
    expect(bondBuyOpportunity(4, 1)).toBeCloseTo(2);
  });

  it("scores a sell by how far the price sits above fundamentals", () => {
    expect(stockSellOpportunity(1)).toBe(1);
    expect(stockSellOpportunity(2)).toBe(8);
    expect(stockSellOpportunity(0.5)).toBe(0.125);
  });

  it("returns 0 for malformed inputs instead of NaN", () => {
    expect(stockBuyOpportunity(Number.NaN, 0.8)).toBe(0);
    expect(stockBuyOpportunity(1, 0)).toBe(0);
    expect(bondBuyOpportunity(-1, 1)).toBe(0);
    expect(stockSellOpportunity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("volumeNormalizedMultipliers", () => {
  it("is the flat engine 5 rate when every opportunity is equal", () => {
    const p = [0.05, 0.075, 0.1];
    const m = volumeNormalizedMultipliers([1.3, 1.3, 1.3], p, expected(p, [1, 1, 1]), 2);
    for (const value of m) expect(value).toBeCloseTo(1);
  });

  it("holds the expected trade count while favouring the better opportunity", () => {
    const p = [0.075, 0.075, 0.075, 0.075];
    const target = expected(p, [1, 1, 1, 1]);
    const m = volumeNormalizedMultipliers([1, 1.2, 1.5, 1.8], p, target, OPPORTUNITY_BUY_CAP);
    expect(expected(p, m)).toBeCloseTo(target, 12);
    expect(m[0]).toBeLessThan(1);
    expect(m[3]).toBeGreaterThan(1);
    expect([...m].sort((a, b) => a - b)).toEqual(m);
  });

  it("caps a standout opportunity and gives its excess to the rest", () => {
    const p = [0.1, 0.1, 0.1, 0.1];
    const target = expected(p, [1, 1, 1, 1]);
    const m = volumeNormalizedMultipliers([100, 1, 1, 1], p, target, OPPORTUNITY_BUY_CAP);
    expect(m[0]).toBe(OPPORTUNITY_BUY_CAP);
    expect(m[1]).toBeCloseTo(2 / 3);
    expect(expected(p, m)).toBeCloseTo(target, 12);
    for (const value of m) expect(value).toBeLessThanOrEqual(OPPORTUNITY_BUY_CAP);
  });

  it("weights the volume target by each decider's base chance", () => {
    const p = [0.05, 0.1];
    const target = expected(p, [1, 1]);
    const m = volumeNormalizedMultipliers([2, 1], p, target, OPPORTUNITY_BUY_CAP);
    expect(expected(p, m)).toBeCloseTo(target, 12);
    expect(m[0] / m[1]).toBeCloseTo(2);
  });

  it("can hold a non-flat engine 5 target such as the price-scaled sell chance", () => {
    const ratios = [0.6, 1, 1.4, 2.2];
    const p = [0.02, 0.03, 0.02, 0.025];
    const target = expected(p, ratios);
    const m = volumeNormalizedMultipliers(
      ratios.map(stockSellOpportunity),
      p,
      target,
      OPPORTUNITY_SELL_CAP
    );
    expect(expected(p, m)).toBeCloseTo(target, 12);
    expect(m[3]).toBeGreaterThan(ratios[3] - 1e-9);
    expect(m[0]).toBeLessThan(ratios[0]);
  });

  it("gives everyone the cap when the target cannot be reached", () => {
    expect(volumeNormalizedMultipliers([1, 2], [0.5, 0.5], 10, 2)).toEqual([2, 2]);
  });

  it("falls back to the flat rate when no score is usable", () => {
    expect(volumeNormalizedMultipliers([0, Number.NaN], [0.1, 0.1], 0.2, 2)).toEqual([1, 1]);
    expect(volumeNormalizedMultipliers([], [], 0, 2)).toEqual([]);
  });
});
