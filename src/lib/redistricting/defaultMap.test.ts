import { describe, it, expect } from "vitest";
import { hashStringToUnit, pviToTilt, buildShapeTilts, buildDefaultSquares } from "./defaultMap";

describe("hashStringToUnit", () => {
  it("is deterministic and within [0,1)", () => {
    const a = hashStringToUnit("CA_3");
    const b = hashStringToUnit("CA_3");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it("differs across inputs", () => {
    expect(hashStringToUnit("CA_1")).not.toBe(hashStringToUnit("CA_2"));
  });
});

describe("pviToTilt", () => {
  it("maps positive PVI to right (+) and negative to left (-), clamped", () => {
    expect(pviToTilt(0)).toBe(0);
    expect(pviToTilt(15)).toBeCloseTo(0.5, 5);
    expect(pviToTilt(-15)).toBeCloseTo(-0.5, 5);
    expect(pviToTilt(60)).toBe(1);
    expect(pviToTilt(-60)).toBe(-1);
  });
});

describe("buildShapeTilts", () => {
  it("uses PVI signs when present", () => {
    const tilts = buildShapeTilts("CA", 3, [11.2, -8, 0]);
    expect(tilts[0]).toBeGreaterThan(0); // right
    expect(tilts[1]).toBeLessThan(0); // left
    expect(tilts[2]).toBe(0);
  });
  it("falls back to a deterministic spread when PVI is null or all-zero", () => {
    const a = buildShapeTilts("TX", 5, null);
    const b = buildShapeTilts("TX", 5, null);
    expect(a).toEqual(b); // deterministic
    expect(a).toHaveLength(5);
    a.forEach((t) => {
      expect(t).toBeGreaterThanOrEqual(-1);
      expect(t).toBeLessThanOrEqual(1);
    });
    // all-zero PVI also triggers the spread (not all zeros out)
    const allZero = buildShapeTilts("TX", 5, [0, 0, 0, 0, 0]);
    expect(allZero.some((t) => t !== 0)).toBe(true);
  });
});

describe("buildDefaultSquares", () => {
  it("conserves the budget exactly and keeps every district at 16 squares", () => {
    const budget = { left: 29, right: 22, grey: 13 }; // n=4, 64 squares
    const tilts = buildShapeTilts("CA", 4, [20, 5, -5, -20]);
    const squares = buildDefaultSquares(4, budget, tilts);

    expect(squares).toHaveLength(4);
    const sum = (k: "left" | "right" | "grey") => squares.reduce((acc, s) => acc + s[k], 0);
    expect(sum("left")).toBe(29);
    expect(sum("right")).toBe(22);
    expect(sum("grey")).toBe(13);
    squares.forEach((s) => {
      expect(s.left + s.right + s.grey).toBe(16);
      expect(s.left).toBeGreaterThanOrEqual(0);
      expect(s.right).toBeGreaterThanOrEqual(0);
      expect(s.grey).toBeGreaterThanOrEqual(0);
    });
  });

  it("puts more right squares in right-tilted districts", () => {
    const budget = { left: 32, right: 32, grey: 0 }; // n=4
    const tilts = [1, 0.5, -0.5, -1]; // d0 most-right, d3 most-left
    const squares = buildDefaultSquares(4, budget, tilts);
    expect(squares[0].right).toBeGreaterThanOrEqual(squares[3].right);
    expect(squares[3].left).toBeGreaterThanOrEqual(squares[0].left);
  });

  it("handles n=1 by giving the single district the whole budget", () => {
    const budget = { left: 4, right: 10, grey: 2 };
    const squares = buildDefaultSquares(1, budget, [0]);
    expect(squares[0]).toEqual({ left: 4, right: 10, grey: 2 });
  });

  it("never produces negative squares for a strongly-skewed, low-grey budget", () => {
    // Heavily-right state with no grey — the case that produced invalid districts
    // like {left:-15, right:31} and crashed the editor render. Sweep skew × n.
    for (let n = 2; n <= 14; n++) {
      for (const rightFrac of [1, 0.9, 0.75]) {
        const total = 16 * n;
        const right = Math.round(total * rightFrac);
        const budget = { left: total - right, right, grey: 0 };
        const tilts = buildShapeTilts("NC", n, null); // deterministic spread, no PVI
        const squares = buildDefaultSquares(n, budget, tilts);
        squares.forEach((s) => {
          expect(s.left).toBeGreaterThanOrEqual(0);
          expect(s.right).toBeGreaterThanOrEqual(0);
          expect(s.grey).toBeGreaterThanOrEqual(0);
          expect(s.left + s.right + s.grey).toBe(16);
        });
        const sum = (k: "left" | "right" | "grey") => squares.reduce((a, s) => a + s[k], 0);
        expect(sum("left")).toBe(budget.left);
        expect(sum("right")).toBe(budget.right);
      }
    }
  });
});
