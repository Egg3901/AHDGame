import { describe, expect, it } from "vitest";
import {
  advanceOutputTrend,
  blendToMeasured,
  nationalOutputGap,
  REAL_OUTPUT_BLEND_TURNS,
  realOutputBlendWeight,
  resolveRealOutputStartTurn,
  seedOutputTrend,
  type OutputTrendState,
} from "./outputTrend";

const run = (start: OutputTrendState, growth: number, turns: number) => {
  let s = start;
  const path: OutputTrendState[] = [];
  for (let i = 0; i < turns; i++) {
    s = advanceOutputTrend(s, growth, 48);
    path.push(s);
  }
  return path;
};

describe("advanceOutputTrend", () => {
  it("seeds at the measured growth with no gap", () => {
    expect(seedOutputTrend(6.5)).toEqual({ gap: 0, trendGrowth: 6.5 });
    expect(seedOutputTrend(Number.NaN)).toEqual({ gap: 0, trendGrowth: 0 });
  });

  it("steady growth at any pace is not a gap", () => {
    for (const g of [-3, 0, 2, 9]) {
      const last = run(seedOutputTrend(g), g, 100).at(-1)!;
      expect(last.gap).toBeCloseTo(0, 9);
      expect(last.trendGrowth).toBeCloseTo(g, 9);
    }
  });

  it("learns a new pace: the trend converges to sustained growth and the gap closes", () => {
    const last = run(seedOutputTrend(2), 8, 400).at(-1)!;
    expect(last.trendGrowth).toBeCloseTo(8, 1);
    expect(Math.abs(last.gap)).toBeLessThan(0.05);
  });

  it("a slowdown opens a negative gap that later closes", () => {
    const path = run(seedOutputTrend(6), 1, 200);
    const trough = Math.min(...path.map((s) => s.gap));
    expect(trough).toBeLessThan(-0.5);
    expect(path[5].gap).toBeLessThan(0);
    expect(Math.abs(path.at(-1)!.gap)).toBeLessThan(Math.abs(trough) / 4);
  });

  it("bounds the gap and trend growth", () => {
    const s = advanceOutputTrend({ gap: 99, trendGrowth: -99 }, 99, 48);
    expect(s.gap).toBeLessThanOrEqual(15);
    expect(s.trendGrowth).toBeLessThanOrEqual(15);
    expect(s.trendGrowth).toBeGreaterThanOrEqual(-15);
  });
});

describe("cutover blend", () => {
  it("ramps 0 to 1 over the blend window", () => {
    expect(realOutputBlendWeight(100, 100)).toBe(0);
    expect(realOutputBlendWeight(112, 100)).toBeCloseTo(0.5, 9);
    expect(realOutputBlendWeight(100 + REAL_OUTPUT_BLEND_TURNS, 100)).toBe(1);
    expect(realOutputBlendWeight(500, 100)).toBe(1);
    expect(realOutputBlendWeight(100, undefined)).toBe(1);
  });

  it("starts a live region now and a fresh region fully measured", () => {
    expect(resolveRealOutputStartTurn(undefined, true, 164)).toBe(164);
    expect(realOutputBlendWeight(1, resolveRealOutputStartTurn(undefined, false, 1))).toBe(1);
    expect(resolveRealOutputStartTurn(150, true, 164)).toBe(150);
  });

  it("moves from legacy to measured with no step", () => {
    expect(blendToMeasured(0.3, 6.6, 0)).toBe(0.3);
    expect(blendToMeasured(0.3, 6.6, 0.5)).toBeCloseTo(3.45, 9);
    expect(blendToMeasured(0.3, 6.6, 1)).toBe(6.6);
    // Successive turns differ by at most 1/24 of the legacy-to-measured spread.
    let prev = blendToMeasured(0.3, 6.6, realOutputBlendWeight(164, 164));
    for (let t = 165; t <= 164 + REAL_OUTPUT_BLEND_TURNS; t++) {
      const v = blendToMeasured(0.3, 6.6, realOutputBlendWeight(t, 164));
      expect(v - prev).toBeLessThanOrEqual((6.6 - 0.3) / REAL_OUTPUT_BLEND_TURNS + 1e-9);
      prev = v;
    }
  });
});

describe("nationalOutputGap", () => {
  it("GDP-weights regions that carry a measured trend", () => {
    const out = nationalOutputGap(
      [
        { gdp: 300, outputGap: 2, outputTrendGrowth: 4, realOutputStartTurn: 164 },
        { gdp: 100, outputGap: -2, outputTrendGrowth: 1, realOutputStartTurn: 164 },
        { gdp: 600, outputGap: 9 }, // legacy gap only: ignored
      ],
      170
    );
    expect(out?.gap).toBeCloseTo(1, 9);
    expect(out?.weight).toBeCloseTo(6 / REAL_OUTPUT_BLEND_TURNS, 9);
  });

  it("returns null before any region is measured", () => {
    expect(nationalOutputGap([{ gdp: 100, outputGap: 3 }], 170)).toBeNull();
    expect(nationalOutputGap([], 170)).toBeNull();
  });
});
