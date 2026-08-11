import { describe, it, expect } from "vitest";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";
import {
  populationWeights,
  gdpWeights,
  largestRemainderAllocate,
  scaleCountVector,
  splitCountVector,
  partitionByGdp,
} from "./apportion";

describe("apportion", () => {
  it("populationWeights sum to 1 and match seed shares", () => {
    const w = populationWeights(scoRegions);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(w["GLA"]).toBeCloseTo(1_160_000 / 5_440_000, 10);
  });

  it("gdpWeights sum to 1", () => {
    const w = gdpWeights(scoRegions);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(w["LOT"]).toBeCloseTo(40_000 / 163_000, 10);
  });

  it("largestRemainderAllocate sums EXACTLY to total (no rounding drift)", () => {
    const alloc = largestRemainderAllocate(5_440_000, populationWeights(scoRegions));
    expect(Object.values(alloc).reduce((a, b) => a + b, 0)).toBe(5_440_000);
    for (const v of Object.values(alloc)) expect(Number.isInteger(v)).toBe(true);
  });

  it("scaleCountVector scales each index by weight", () => {
    expect(scaleCountVector([100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });

  it("splitCountVector conserves each cohort index exactly across sub-regions", () => {
    const vec = [101, 200, 51];
    const split = splitCountVector(vec, populationWeights(scoRegions));
    for (let i = 0; i < vec.length; i++) {
      const sum = Object.values(split).reduce((a, b) => a + b[i], 0);
      expect(sum).toBe(vec[i]);
    }
    // Every sub-region present with a same-length vector.
    expect(Object.keys(split).sort()).toEqual(scoRegions.map((s) => s._id).sort());
    for (const v of Object.values(split)) expect(v).toHaveLength(vec.length);
  });

  it("partitionByGdp assigns every item exactly once, roughly GDP-weighted", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, rev: 10 }));
    const buckets = partitionByGdp(items, (x) => x.rev, scoRegions);
    const assigned = Object.values(buckets).flat().length;
    expect(assigned).toBe(30);
    // Largest GDP share (LOT) gets no fewer items than the smallest (HIG).
    expect(buckets["LOT"].length).toBeGreaterThanOrEqual(buckets["HIG"].length);
  });
});
