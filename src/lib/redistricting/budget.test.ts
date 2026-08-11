import { describe, it, expect } from "vitest";
import { largestRemainderAllocate, computeSquareBudget } from "./budget";

describe("largestRemainderAllocate", () => {
  it("allocates exactly `total` across weights, largest remainders first", () => {
    // total 10 over weights [1,1,1]: floors 3,3,3 = 9; one remainder unit to the first by tie-break
    const result = largestRemainderAllocate(10, [1, 1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10);
    expect(result).toEqual([4, 3, 3]);
  });

  it("returns all zeros when total is 0", () => {
    expect(largestRemainderAllocate(0, [2, 5, 1])).toEqual([0, 0, 0]);
  });

  it("spreads evenly when weights are all zero", () => {
    const result = largestRemainderAllocate(4, [0, 0, 0, 0]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(4);
    expect(result).toEqual([1, 1, 1, 1]);
  });
});

describe("computeSquareBudget", () => {
  it("produces squares summing to 16*n with grey as residual", () => {
    const b = computeSquareBudget({ left: 45, right: 35, grey: 20 }, 4); // 64 squares
    expect(b.left + b.right + b.grey).toBe(64);
    expect(b.left).toBe(29); // round(0.45*64)=28.8→29
    expect(b.right).toBe(22); // round(0.35*64)=22.4→22
    expect(b.grey).toBe(13); // 64-29-22
  });

  it("never produces negative grey; trims the largest pool if needed", () => {
    const b = computeSquareBudget({ left: 60, right: 55, grey: 0 }, 1); // overshoot
    expect(b.left + b.right + b.grey).toBe(16);
    expect(b.grey).toBeGreaterThanOrEqual(0);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeGreaterThanOrEqual(0);
  });

  it("guarantees at least one left and one right square, borrowing from grey", () => {
    // A near-all-grey input would otherwise round both two-party sides to 0.
    const b = computeSquareBudget({ left: 0.2, right: 0.2, grey: 99.6 }, 30); // 480 squares
    expect(b.left + b.right + b.grey).toBe(480);
    expect(b.left).toBeGreaterThanOrEqual(1);
    expect(b.right).toBeGreaterThanOrEqual(1);
  });

  it("keeps the total exact when forcing minimums on a tiny budget", () => {
    const b = computeSquareBudget({ left: 0, right: 0, grey: 100 }, 1); // 16 squares
    expect(b.left + b.right + b.grey).toBe(16);
    expect(b.left).toBeGreaterThanOrEqual(1);
    expect(b.right).toBeGreaterThanOrEqual(1);
  });
});
