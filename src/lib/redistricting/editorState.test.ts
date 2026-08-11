import { describe, it, expect } from "vitest";
import type { Pool } from "./pools";
import {
  cyclePool,
  cellsToSquares,
  tallyAllocation,
  remainingBudget,
  gridToSquares,
} from "./editorState";

describe("cyclePool", () => {
  it("cycles left → right → grey → left", () => {
    expect(cyclePool("left")).toBe("right");
    expect(cyclePool("right")).toBe("grey");
    expect(cyclePool("grey")).toBe("left");
  });
});

describe("cellsToSquares", () => {
  it("counts a 16-cell array into pool counts", () => {
    const cells: Pool[] = [
      ...new Array(7).fill("left"),
      ...new Array(4).fill("grey"),
      ...new Array(5).fill("right"),
    ];
    expect(cellsToSquares(cells)).toEqual({ left: 7, right: 5, grey: 4 });
  });
});

describe("tallyAllocation / remainingBudget", () => {
  const grid: Pool[][] = [[...new Array(16).fill("left")], [...new Array(16).fill("right")]];
  it("tallies across districts", () => {
    expect(tallyAllocation(grid)).toEqual({ left: 16, right: 16, grey: 0 });
  });
  it("computes remaining budget (zero when matched)", () => {
    expect(remainingBudget({ left: 16, right: 16, grey: 0 }, grid)).toEqual({
      left: 0,
      right: 0,
      grey: 0,
    });
  });
  it("can go negative when over-allocated", () => {
    expect(remainingBudget({ left: 10, right: 16, grey: 0 }, grid).left).toBe(-6);
  });
});

describe("gridToSquares", () => {
  it("maps each district's cells to squares", () => {
    const grid: Pool[][] = [[...new Array(8).fill("left"), ...new Array(8).fill("right")]];
    expect(gridToSquares(grid)).toEqual([{ left: 8, right: 8, grey: 0 }]);
  });
});
