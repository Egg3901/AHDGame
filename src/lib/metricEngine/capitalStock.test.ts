import { describe, expect, it } from "vitest";
import {
  investmentRate,
  advanceCapitalStock,
  seedCapitalStock,
  CAPITAL_OUTPUT_RATIO_TARGET,
  BASE_INVESTMENT_RATE,
  NEUTRAL_PRIME_RATE,
} from "./capitalStock";

const TPY = 48;

describe("investmentRate", () => {
  it("equals the base rate at the neutral prime rate", () => {
    expect(investmentRate(NEUTRAL_PRIME_RATE)).toBeCloseTo(BASE_INVESTMENT_RATE, 6);
  });
  it("rises as rates fall and falls as rates rise (monetary coupling)", () => {
    expect(investmentRate(0)).toBeGreaterThan(investmentRate(NEUTRAL_PRIME_RATE));
    expect(investmentRate(10)).toBeLessThan(investmentRate(NEUTRAL_PRIME_RATE));
  });
  it("clamps to a sane band for extreme rates", () => {
    expect(investmentRate(-50)).toBeLessThanOrEqual(0.4);
    expect(investmentRate(50)).toBeGreaterThanOrEqual(0.05);
  });
});

describe("seedCapitalStock", () => {
  it("seeds K = target × GDP (millions)", () => {
    expect(seedCapitalStock(1000)).toBe(CAPITAL_OUTPUT_RATIO_TARGET * 1000);
  });
  it("floors non-finite / non-positive GDP to 0", () => {
    expect(seedCapitalStock(NaN)).toBe(0);
    expect(seedCapitalStock(-5)).toBe(0);
  });
});

describe("advanceCapitalStock", () => {
  const k0 = seedCapitalStock(1000); // 3000 at Y=1000, already steady at neutral rate

  it("holds steady (ΔK≈0) when seeded at K/Y target and rate is neutral", () => {
    const r = advanceCapitalStock(k0, 1000, NEUTRAL_PRIME_RATE, TPY);
    expect(r.capital).toBeCloseTo(k0, 4); // investment ≈ depreciation
    expect(Math.abs(r.annualizedGrowth)).toBeLessThan(1e-6);
  });
  it("grows the stock when below steady state", () => {
    const r = advanceCapitalStock(1000, 1000, NEUTRAL_PRIME_RATE, TPY); // K/Y=1 < 3
    expect(r.capital).toBeGreaterThan(1000);
    expect(r.annualizedGrowth).toBeGreaterThan(0);
  });
  it("shrinks the stock when above steady state", () => {
    const r = advanceCapitalStock(6000, 1000, NEUTRAL_PRIME_RATE, TPY); // K/Y=6 > 3
    expect(r.capital).toBeLessThan(6000);
    expect(r.annualizedGrowth).toBeLessThan(0);
  });
  it("never goes negative and tolerates non-finite inputs", () => {
    expect(advanceCapitalStock(0, 0, NEUTRAL_PRIME_RATE, TPY).capital).toBeGreaterThanOrEqual(0);
    expect(advanceCapitalStock(NaN, 1000, NEUTRAL_PRIME_RATE, TPY).capital).toBeGreaterThanOrEqual(
      0
    );
  });
});
