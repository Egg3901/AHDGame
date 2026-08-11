import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURNOVER_MARKUP,
  administeredNationalPrice,
  turnoverTaxRevenue,
  demandSupplyGapPct,
  dualTrackPrice,
} from "./administeredPricing";

const NAN_CASES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("administeredNationalPrice", () => {
  it("is base * (1 + markup) with markup floored at 0", () => {
    expect(administeredNationalPrice(100, 0.12)).toBeCloseTo(112, 10);
    expect(administeredNationalPrice(100, 0)).toBe(100);
    expect(administeredNationalPrice(50, DEFAULT_TURNOVER_MARKUP)).toBeCloseTo(
      50 * (1 + DEFAULT_TURNOVER_MARKUP),
      10
    );
    // Negative markup is treated as 0 → price equals base.
    expect(administeredNationalPrice(80, -0.5)).toBe(80);
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(administeredNationalPrice(bad, 0.12))).toBe(true);
      expect(Number.isFinite(administeredNationalPrice(100, bad))).toBe(true);
    }
  });
});

describe("turnoverTaxRevenue", () => {
  it("is 0 when units are 0", () => {
    expect(turnoverTaxRevenue(100, 0, 0.12)).toBe(0);
  });

  it("scales with units and markup", () => {
    const base = turnoverTaxRevenue(10, 5, 0.1);
    const moreUnits = turnoverTaxRevenue(10, 10, 0.1);
    const moreMarkup = turnoverTaxRevenue(10, 5, 0.2);
    expect(moreUnits).toBeGreaterThan(base);
    expect(moreMarkup).toBeGreaterThan(base);
    expect(moreUnits).toBeCloseTo(base * 2, 10);
    expect(moreMarkup).toBeCloseTo(base * 2, 10);
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(turnoverTaxRevenue(bad, 5, 0.12))).toBe(true);
      expect(Number.isFinite(turnoverTaxRevenue(100, bad, 0.12))).toBe(true);
      expect(Number.isFinite(turnoverTaxRevenue(100, 5, bad))).toBe(true);
    }
  });
});

describe("demandSupplyGapPct", () => {
  it("is 0 when demand <= supply", () => {
    expect(demandSupplyGapPct(100, 80)).toBe(0);
    expect(demandSupplyGapPct(100, 100)).toBe(0);
    expect(demandSupplyGapPct(0, 0)).toBe(0);
  });

  it("is positive and increasing when demand > supply", () => {
    const mild = demandSupplyGapPct(100, 120);
    const severe = demandSupplyGapPct(100, 200);
    expect(mild).toBeGreaterThan(0);
    expect(severe).toBeGreaterThan(mild);
    expect(Number.isFinite(mild)).toBe(true);
    expect(Number.isFinite(severe)).toBe(true);
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(demandSupplyGapPct(bad, 50))).toBe(true);
      expect(Number.isFinite(demandSupplyGapPct(50, bad))).toBe(true);
    }
  });
});

describe("dualTrackPrice", () => {
  const administered = 40;
  const market = 100;

  it("equals administered when share = 1 and market when share = 0", () => {
    expect(dualTrackPrice(administered, market, 1)).toBe(administered);
    expect(dualTrackPrice(administered, market, 0)).toBe(market);
  });

  it("is monotonic between the endpoints as share rises", () => {
    const at0 = dualTrackPrice(administered, market, 0);
    const at025 = dualTrackPrice(administered, market, 0.25);
    const at05 = dualTrackPrice(administered, market, 0.5);
    const at075 = dualTrackPrice(administered, market, 0.75);
    const at1 = dualTrackPrice(administered, market, 1);
    // administered < market → higher planned share pulls price down toward administered
    expect(at025).toBeLessThan(at0);
    expect(at05).toBeLessThan(at025);
    expect(at075).toBeLessThan(at05);
    expect(at1).toBeLessThan(at075);
    expect(at05).toBeCloseTo((administered + market) / 2, 10);
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(dualTrackPrice(bad, 100, 0.5))).toBe(true);
      expect(Number.isFinite(dualTrackPrice(40, bad, 0.5))).toBe(true);
      expect(Number.isFinite(dualTrackPrice(40, 100, bad))).toBe(true);
    }
  });
});
