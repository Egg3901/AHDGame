import { describe, it, expect } from "vitest";
import { reachableBucket, reachableColor, getReachableLegendStops } from "./commodityMapColorScale";

describe("reachableBucket", () => {
  it("treats no signal as unknown, never as balanced", () => {
    // A country with no book and a genuinely balanced one are different
    // answers, and painting them the same colour hides the first.
    for (const v of [null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(reachableBucket(v as number | null).arm).toBe("unknown");
    }
    expect(reachableBucket(1).arm).toBe("balanced");
  });

  it("uses the same balanced band as the shortage heat map", () => {
    expect(reachableBucket(0.85).arm).toBe("balanced");
    expect(reachableBucket(1.15).arm).toBe("balanced");
    expect(reachableBucket(0.84).arm).toBe("glut");
    expect(reachableBucket(1.16).arm).toBe("short");
  });

  it("escalates the shortage arm by imbalance, not linearly", () => {
    expect(reachableBucket(1.2)).toEqual({ arm: "short", step: 0 });
    expect(reachableBucket(1.6)).toEqual({ arm: "short", step: 1 });
    expect(reachableBucket(2.5)).toEqual({ arm: "short", step: 2 });
    expect(reachableBucket(9)).toEqual({ arm: "short", step: 3 });
  });

  it("mirrors the glut arm on the reciprocal", () => {
    // 0.5 is a 2x glut and must land on the same step as a 2x shortage.
    expect(reachableBucket(0.5)).toEqual({ arm: "glut", step: 2 });
    expect(reachableBucket(1 / 3)).toEqual({ arm: "glut", step: 3 });
    expect(reachableBucket(1 / 1.6)).toEqual({ arm: "glut", step: 1 });
    // 1/0.7 is a 1.43x glut, below the 1.5 step, so it stays on the first.
    expect(reachableBucket(0.7)).toEqual({ arm: "glut", step: 0 });
  });

  it("places the live turn-97 oil readings on opposite arms", () => {
    // World oil read 0.82 (glut, which is what the old gate saw) while the
    // US-reachable book ran 1.82 (shortage). The map must not paint those alike.
    expect(reachableBucket(0.82).arm).toBe("glut");
    expect(reachableBucket(1.82).arm).toBe("short");
  });
});

describe("reachableColor", () => {
  it("gives the balanced midpoint a neutral gray, never a hue", () => {
    // Diverging scales take a neutral midpoint; a hue there invents polarity
    // where the data has none.
    expect(reachableColor(1)).toBe("#8A8F98");
  });

  it("returns distinct fills per arm", () => {
    expect(reachableColor(3)).not.toBe(reachableColor(1 / 3));
    expect(reachableColor(3)).not.toBe(reachableColor(1));
  });

  it("darkens monotonically as imbalance grows on each arm", () => {
    const shortFills = [1.2, 1.6, 2.5, 9].map(reachableColor);
    const glutFills = [1 / 1.2, 1 / 1.6, 1 / 2.5, 1 / 9].map(reachableColor);
    expect(new Set(shortFills).size).toBe(4);
    expect(new Set(glutFills).size).toBe(4);
  });
});

describe("getReachableLegendStops", () => {
  it("runs glut -> balanced -> shortage with the neutral in the middle", () => {
    const stops = getReachableLegendStops();
    expect(stops).toHaveLength(5);
    expect(stops[0].label).toBe("Glut");
    expect(stops[2].label).toBe("Balanced");
    expect(stops[2].color).toBe("#8A8F98");
    expect(stops[4].label).toBe("Shortage");
  });
});
