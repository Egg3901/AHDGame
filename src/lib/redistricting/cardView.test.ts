import { describe, it, expect } from "vitest";
import {
  buildSquareCells,
  districtLeanLabel,
  netLeanIndicator,
  categorizeDistrict,
  summarizeComposition,
  LEAN_SAFE_THRESHOLD,
  LEAN_TILT_THRESHOLD,
} from "./cardView";

describe("buildSquareCells", () => {
  it("returns 16 cells matching the square counts, ordered left→grey→right", () => {
    const cells = buildSquareCells({ left: 7, grey: 4, right: 5 });
    expect(cells).toHaveLength(16);
    expect(cells.filter((c) => c === "left")).toHaveLength(7);
    expect(cells.filter((c) => c === "grey")).toHaveLength(4);
    expect(cells.filter((c) => c === "right")).toHaveLength(5);
    // ordering: all lefts first, then greys, then rights
    expect(cells.slice(0, 7).every((c) => c === "left")).toBe(true);
    expect(cells.slice(7, 11).every((c) => c === "grey")).toBe(true);
    expect(cells.slice(11).every((c) => c === "right")).toBe(true);
  });

  it("handles a fully-packed district", () => {
    const cells = buildSquareCells({ left: 16, grey: 0, right: 0 });
    expect(cells).toEqual(new Array(16).fill("left"));
  });

  it("does not throw on a malformed (negative) square count", () => {
    // Defensive: a bad doc must never crash the render via `new Array(-n)`.
    expect(() => buildSquareCells({ left: -15, grey: 0, right: 31 })).not.toThrow();
    const cells = buildSquareCells({ left: -15, grey: 0, right: 31 });
    expect(cells.every((c) => c === "left" || c === "grey" || c === "right")).toBe(true);
  });
});

describe("districtLeanLabel", () => {
  it("labels left/right/even from netLean", () => {
    expect(districtLeanLabel(-6)).toEqual({ side: "Left", magnitude: 6, text: "Left +6" });
    expect(districtLeanLabel(8)).toEqual({ side: "Right", magnitude: 8, text: "Right +8" });
    expect(districtLeanLabel(0)).toEqual({ side: "Even", magnitude: 0, text: "Even" });
  });
});

describe("netLeanIndicator", () => {
  it("points left for negative lean and right for positive", () => {
    expect(netLeanIndicator(-3).text).toBe("← +3");
    expect(netLeanIndicator(2).text).toBe("→ +2");
    expect(netLeanIndicator(0).text).toBe("Even");
  });
});

describe("categorizeDistrict", () => {
  it("buckets at the threshold boundaries", () => {
    expect(categorizeDistrict(-LEAN_SAFE_THRESHOLD)).toBe("safeLeft");
    expect(categorizeDistrict(-LEAN_SAFE_THRESHOLD + 1)).toBe("leanLeft");
    expect(categorizeDistrict(-LEAN_TILT_THRESHOLD)).toBe("leanLeft");
    expect(categorizeDistrict(-LEAN_TILT_THRESHOLD + 1)).toBe("competitive");
    expect(categorizeDistrict(0)).toBe("competitive");
    expect(categorizeDistrict(LEAN_TILT_THRESHOLD - 1)).toBe("competitive");
    expect(categorizeDistrict(LEAN_TILT_THRESHOLD)).toBe("leanRight");
    expect(categorizeDistrict(LEAN_SAFE_THRESHOLD - 1)).toBe("leanRight");
    expect(categorizeDistrict(LEAN_SAFE_THRESHOLD)).toBe("safeRight");
  });
});

describe("summarizeComposition", () => {
  it("counts categories and computes percentages", () => {
    const districts = [
      { left: 13, grey: 1, right: 2 }, // -11 safeLeft
      { left: 9, grey: 2, right: 5 }, // -4 leanLeft
      { left: 8, grey: 1, right: 7 }, // -1 competitive
      { left: 6, grey: 1, right: 9 }, // +3 leanRight
      { left: 3, grey: 1, right: 12 }, // +9 safeRight
    ];
    const s = summarizeComposition(districts);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({
      safeLeft: 1,
      leanLeft: 1,
      competitive: 1,
      leanRight: 1,
      safeRight: 1,
    });
    expect(s.percents.competitive).toBeCloseTo(20);
  });

  it("handles an empty district list", () => {
    const s = summarizeComposition([]);
    expect(s.total).toBe(0);
    expect(s.percents.competitive).toBe(0);
  });
});
