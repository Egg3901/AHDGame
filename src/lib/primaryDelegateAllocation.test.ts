import { describe, it, expect } from "vitest";
import {
  allocateProportional,
  allocateWinnerTakeAll,
  allocateDelegates,
  PR_VIABILITY_THRESHOLD,
} from "./primaryDelegateAllocation";

describe("allocateProportional", () => {
  it("returns empty allocation when no votes cast", () => {
    const result = allocateProportional({}, 100);
    expect(result.byCandidate).toEqual({});
    expect(result.totalAwarded).toBe(0);
  });

  it("returns empty allocation when delegatesAvailable is zero", () => {
    const result = allocateProportional({ a: 100, b: 50 }, 0);
    expect(result.byCandidate).toEqual({});
    expect(result.totalAwarded).toBe(0);
  });

  it("applies 15% viability threshold", () => {
    // b at 10% of total is non-viable
    const result = allocateProportional({ a: 90, b: 10 }, 100);
    expect(result.nonViable).toEqual(["b"]);
    expect(result.byCandidate.b).toBeUndefined();
    expect(result.byCandidate.a).toBe(100);
  });

  it("keeps candidates exactly at threshold as viable", () => {
    const result = allocateProportional({ a: 85, b: 15 }, 100);
    expect(result.nonViable).toEqual([]);
    expect(result.byCandidate.a).toBeGreaterThan(0);
    expect(result.byCandidate.b).toBeGreaterThan(0);
  });

  it("allocates proportionally among viable candidates", () => {
    // 50/30/20 split, all viable (20 >= 15). 100 delegates.
    const result = allocateProportional({ a: 50, b: 30, c: 20 }, 100);
    expect(result.byCandidate.a).toBe(50);
    expect(result.byCandidate.b).toBe(30);
    expect(result.byCandidate.c).toBe(20);
    expect(result.totalAwarded).toBe(100);
  });

  it("rebalances pool when some candidates are non-viable", () => {
    // a=50, b=40, c=10 (non-viable). Redistribute c's share across viable a+b.
    const result = allocateProportional({ a: 50, b: 40, c: 10 }, 90);
    expect(result.nonViable).toEqual(["c"]);
    expect(result.byCandidate.c).toBeUndefined();
    // a gets 50/90 * 90 = 50; b gets 40/90 * 90 = 40
    expect(result.byCandidate.a).toBe(50);
    expect(result.byCandidate.b).toBe(40);
    expect(result.totalAwarded).toBe(90);
  });

  it("uses Hamilton's method for remainders", () => {
    // 3 candidates tied at 100 votes each, 10 delegates
    // Each gets 3.33 → floor 3, remainder 0.33. Leftover = 1.
    // Largest remainder wins the extra, broken by vote tie → candidateId asc
    const result = allocateProportional({ a: 100, b: 100, c: 100 }, 10);
    expect(result.totalAwarded).toBe(10);
    expect(result.byCandidate.a + result.byCandidate.b + result.byCandidate.c).toBe(10);
    // One candidate gets 4, others get 3
    const counts = Object.values(result.byCandidate).sort();
    expect(counts).toEqual([3, 3, 4]);
  });

  it("falls back to full field if nobody clears viability", () => {
    // 5 candidates at 20% each — all viable
    const result5 = allocateProportional({ a: 20, b: 20, c: 20, d: 20, e: 20 }, 10);
    expect(result5.nonViable).toEqual([]);

    // Now 7 candidates roughly equal — each below 15%
    const result7 = allocateProportional({ a: 15, b: 14, c: 14, d: 14, e: 14, f: 14, g: 15 }, 10);
    // With nobody above 15%, fall back to allocating across full field
    expect(result7.totalAwarded).toBe(10);
  });

  it("verifies threshold constant is 15%", () => {
    expect(PR_VIABILITY_THRESHOLD).toBe(0.15);
  });
});

describe("allocateWinnerTakeAll", () => {
  it("returns empty when no votes", () => {
    const result = allocateWinnerTakeAll({}, 50);
    expect(result.byCandidate).toEqual({});
  });

  it("gives all delegates to plurality winner", () => {
    const result = allocateWinnerTakeAll({ a: 100, b: 99, c: 50 }, 50);
    expect(result.byCandidate.a).toBe(50);
    expect(result.byCandidate.b).toBeUndefined();
    expect(result.byCandidate.c).toBeUndefined();
    expect(result.totalAwarded).toBe(50);
  });

  it("breaks ties deterministically by candidateId ascending", () => {
    const result = allocateWinnerTakeAll({ z: 100, a: 100, m: 100 }, 10);
    // "a" wins the tie
    expect(result.byCandidate.a).toBe(10);
    expect(result.byCandidate.z).toBeUndefined();
    expect(result.byCandidate.m).toBeUndefined();
  });

  it("ignores candidates with zero votes", () => {
    const result = allocateWinnerTakeAll({ a: 0, b: 1, c: 0 }, 5);
    expect(result.byCandidate.b).toBe(5);
  });
});

describe("allocateDelegates dispatch", () => {
  it("dispatches PR to allocateProportional", () => {
    const result = allocateDelegates("PR", { a: 60, b: 40 }, 10);
    expect(result.byCandidate.a).toBe(6);
    expect(result.byCandidate.b).toBe(4);
  });

  it("dispatches WTA to allocateWinnerTakeAll", () => {
    const result = allocateDelegates("WTA", { a: 60, b: 40 }, 10);
    expect(result.byCandidate.a).toBe(10);
    expect(result.byCandidate.b).toBeUndefined();
  });
});
