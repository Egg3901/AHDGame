import { describe, expect, it } from "vitest";
import { DEMAND_PROBE_MARGIN, DEMAND_THROTTLE_FLOOR, demandThrottleFactor } from "./demandThrottle";

describe("demandThrottleFactor — flip identity", () => {
  it("does not throttle a plant running at capacity and clearing it", () => {
    // Target 1,150 exceeds the 1,000 it can physically make, so nothing moves.
    expect(demandThrottleFactor(1_000, 1_000, 1_000)).toBe(1);
  });

  it("still ramps a plant that cleared a REDUCED run, rather than restoring it in full", () => {
    // Restoring full capacity the moment a throttled plant sells out is exactly
    // the oscillation this design avoids: it would glut again next turn.
    const factor = demandThrottleFactor(1_000, 800, 800);
    expect(factor).toBeLessThan(1);
    expect(factor * 1_000).toBeCloseTo(800 * (1 + DEMAND_PROBE_MARGIN), 6);
  });

  it("does not throttle a sector with no production history", () => {
    // Newly founded, or a world that has never run the clearing pre-pass.
    expect(demandThrottleFactor(1_000, null, null)).toBe(1);
    expect(demandThrottleFactor(1_000, 0, 0)).toBe(1);
    expect(demandThrottleFactor(1_000, 500, undefined)).toBe(1);
  });

  it("does not throttle when last turn's sales already cover this turn's plan", () => {
    // Sold 950 of 1,000, so the probe target is 1,092.5 — above the 1,000
    // planned, and a near-clearing plant should not be penalised.
    expect(demandThrottleFactor(1_000, 950, 1_000)).toBe(1);
  });

  it("returns 1 for a plant that is producing nothing anyway", () => {
    expect(demandThrottleFactor(0, 10, 1_000)).toBe(1);
    expect(demandThrottleFactor(Number.NaN, 10, 1_000)).toBe(1);
  });

  it("ignores a non-finite sales figure rather than throttling on garbage", () => {
    expect(demandThrottleFactor(1_000, Number.NaN, 1_000)).toBe(1);
  });
});

describe("demandThrottleFactor — glut", () => {
  it("targets last turn's sales plus the probe margin", () => {
    // The reported shape: 60k made, 10k sold.
    const factor = demandThrottleFactor(60_000, 10_000, 60_000);
    expect(factor * 60_000).toBeCloseTo(10_000 * (1 + DEMAND_PROBE_MARGIN), 6);
  });

  it("cuts cost roughly in proportion, which is the whole point", () => {
    // Inputs bill at producedUnits; revenue books at soldUnits. Bringing
    // production down to what sells is what closes the -254% margin.
    const factor = demandThrottleFactor(60_000, 10_000, 60_000);
    expect(factor).toBeLessThan(0.2);
    expect(factor).toBeGreaterThan(DEMAND_THROTTLE_FLOOR);
  });

  it("never idles a plant completely, even after selling nothing", () => {
    // Zero output means zero presence on the clearing book, which would make
    // "sold nothing" permanent and self-fulfilling. Mothball is the deliberate
    // way to stop, and it zeroes production upstream of this.
    expect(demandThrottleFactor(60_000, 0, 60_000)).toBe(DEMAND_THROTTLE_FLOOR);
  });

  it("stays within [floor, 1] across the whole range of sales", () => {
    for (const sold of [0, 1, 100, 5_000, 30_000, 59_999, 60_000]) {
      const f = demandThrottleFactor(60_000, sold, 60_000);
      expect(f).toBeGreaterThanOrEqual(DEMAND_THROTTLE_FLOOR);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe("demandThrottleFactor — convergence", () => {
  it("ramps back up while the market absorbs the extra, instead of oscillating", () => {
    // A fraction-based throttle oscillates: cut to what sold, sell all of it,
    // read soldFraction 1.0, produce full, glut again. Targeting absolute sold
    // units converges upward instead.
    const capacity = 60_000;
    let produced = capacity;
    let sold = 10_000;
    const path: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      const next = capacity * demandThrottleFactor(capacity, sold, produced);
      path.push(next);
      produced = next;
      sold = next; // the market takes everything offered
    }
    // Strictly increasing, and never back to a 60k glut.
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThan(path[i - 1]);
    expect(path[path.length - 1]).toBeLessThan(capacity);
    expect(path[0]).toBeCloseTo(11_500, 6);
  });

  it("settles when the market stops absorbing more", () => {
    const capacity = 60_000;
    // Offered 11,500, sold only 10,000 again: the target is unchanged, so the
    // plan settles rather than ratcheting down.
    const first = capacity * demandThrottleFactor(capacity, 10_000, capacity);
    const second = capacity * demandThrottleFactor(capacity, 10_000, first);
    expect(second).toBeCloseTo(first, 6);
  });
});
