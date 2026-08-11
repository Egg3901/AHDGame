import { describe, it, expect } from "vitest";
import { hemicycleLayout, benchLayout, horseshoeLayout } from "./seatingLayouts";

describe("hemicycleLayout", () => {
  it("returns exactly `total` seats for realistic chambers", () => {
    for (const total of [100, 435, 630, 650]) {
      expect(hemicycleLayout(total).pts).toHaveLength(total);
    }
  });

  it("does not hang and returns ≤ total seats for degenerate sizes", () => {
    // Regression: total < 3 previously wedged the down-adjust loop forever.
    for (const total of [0, 1, 2]) {
      const { pts } = hemicycleLayout(total);
      expect(pts.length).toBeLessThanOrEqual(total);
    }
    expect(hemicycleLayout(0).pts).toHaveLength(0);
  });

  it("seatR is positive", () => {
    expect(hemicycleLayout(435).seatR).toBeGreaterThan(0);
  });
});

describe("benchLayout", () => {
  it("returns exactly `total` seats", () => {
    for (const total of [120, 650]) {
      expect(benchLayout(total).pts).toHaveLength(total);
    }
  });

  it("handles zero seats without error", () => {
    expect(benchLayout(0).pts).toHaveLength(0);
  });
});

describe("horseshoeLayout", () => {
  it("produces exactly `total` seat points", () => {
    for (const total of [40, 100, 174, 250]) {
      expect(horseshoeLayout(total).pts).toHaveLength(total);
    }
  });

  it("returns a viewBox of [x, y, w, h] and a chairY inside it", () => {
    const { vb, chairY } = horseshoeLayout(174);
    expect(vb).toHaveLength(4);
    const vy = vb[1];
    const vh = vb[3];
    expect(chairY).toBeGreaterThan(vy);
    expect(chairY).toBeLessThan(vy + vh);
  });

  it("is symmetric: left-leg and right-leg seats mirror across x=0", () => {
    const { pts } = horseshoeLayout(120);
    const left = pts.filter((p) => p.x < -0.01).length;
    const right = pts.filter((p) => p.x > 0.01).length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
  });

  it("seatR is positive and small", () => {
    const { seatR } = horseshoeLayout(174);
    expect(seatR).toBeGreaterThan(0);
    expect(seatR).toBeLessThan(0.2);
  });
});
