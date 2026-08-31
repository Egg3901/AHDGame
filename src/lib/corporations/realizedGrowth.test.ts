import { describe, expect, it } from "vitest";

import {
  CORP_GROWTH_MIN_SPAN_TURNS,
  CORP_GROWTH_TARGET_SPAN_TURNS,
  computeCorpRealizedGrowthRate,
} from "./realizedGrowth";

describe("computeCorpRealizedGrowthRate", () => {
  it("annualizes a full-year revenue delta at face value", () => {
    const growth = computeCorpRealizedGrowthRate([
      { turn: 100, revenue: 1000 },
      { turn: 100 + CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 1200 },
    ]);
    expect(growth).toBeCloseTo(20);
  });

  it("scales a part-year span up to an annual rate", () => {
    // Half a year at +10% is +20%/yr.
    const growth = computeCorpRealizedGrowthRate([
      { turn: 100, revenue: 1000 },
      { turn: 100 + CORP_GROWTH_TARGET_SPAN_TURNS / 2, revenue: 1100 },
    ]);
    expect(growth).toBeCloseTo(20);
  });

  it("reports contraction as a negative rate", () => {
    const growth = computeCorpRealizedGrowthRate([
      { turn: 0, revenue: 1000 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 750 },
    ]);
    expect(growth).toBeCloseTo(-25);
  });

  it("does NOT clamp to the GDP signal band", () => {
    // The region helper clamps to [-10, 15]; a CEO must see the real number.
    const growth = computeCorpRealizedGrowthRate([
      { turn: 0, revenue: 100 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 200 },
    ]);
    expect(growth).toBeCloseTo(100);
  });

  it("refuses to annualize a span shorter than the noise floor", () => {
    // One turn of +10% churn would otherwise print as +480%/yr.
    expect(
      computeCorpRealizedGrowthRate([
        { turn: 100, revenue: 1000 },
        { turn: 101, revenue: 1100 },
      ])
    ).toBeNull();
    expect(
      computeCorpRealizedGrowthRate([
        { turn: 100, revenue: 1000 },
        { turn: 100 + CORP_GROWTH_MIN_SPAN_TURNS - 1, revenue: 1100 },
      ])
    ).toBeNull();
  });

  it("prefers the baseline closest to a year back when several qualify", () => {
    // The 12-turn-old point would annualize a short window; the year-old one is
    // the honest baseline, and it reports +20% rather than the noisier +40%.
    const growth = computeCorpRealizedGrowthRate([
      { turn: 0, revenue: 1000 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS - 12, revenue: 1150 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 1200 },
    ]);
    expect(growth).toBeCloseTo(20);
  });

  it("returns null when there is no usable baseline", () => {
    expect(computeCorpRealizedGrowthRate([])).toBeNull();
    expect(computeCorpRealizedGrowthRate([{ turn: 10, revenue: 500 }])).toBeNull();
    // A zero prior would divide by zero.
    expect(
      computeCorpRealizedGrowthRate([
        { turn: 0, revenue: 0 },
        { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 900 },
      ])
    ).toBeNull();
    // Non-finite rows are dropped before the baseline search.
    expect(
      computeCorpRealizedGrowthRate([
        { turn: 0, revenue: Number.NaN },
        { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 900 },
      ])
    ).toBeNull();
  });

  it("handles a corp that fell to zero revenue without blowing up", () => {
    const growth = computeCorpRealizedGrowthRate([
      { turn: 0, revenue: 800 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 0 },
    ]);
    expect(growth).toBeCloseTo(-100);
  });

  it("is order-independent", () => {
    const ascending = computeCorpRealizedGrowthRate([
      { turn: 0, revenue: 1000 },
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 1200 },
    ]);
    const descending = computeCorpRealizedGrowthRate([
      { turn: CORP_GROWTH_TARGET_SPAN_TURNS, revenue: 1200 },
      { turn: 0, revenue: 1000 },
    ]);
    expect(descending).toBe(ascending);
  });
});
