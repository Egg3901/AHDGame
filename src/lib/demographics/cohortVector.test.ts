import { describe, expect, it } from "vitest";
import {
  totalPopulation,
  coarseGroups,
  workingAge,
  childbearing,
  medianAgeFromVector,
  sexRatioFromVector,
  dependencyRatio,
  votingAgePopulation,
  workingAgePopulation,
  type AgeSexVector,
} from "./cohortVector";

// A tiny uniform vector: 100 people at each of ages 0..100, split 50/50 → 10,100 each sex.
function uniform(perAgePerSex = 100): AgeSexVector {
  const arr = () => Array.from({ length: 101 }, () => perAgePerSex);
  return { male: arr(), female: arr() };
}

describe("cohortVector derived views", () => {
  it("totalPopulation sums both sexes across all ages", () => {
    expect(totalPopulation(uniform(100))).toBe(101 * 100 * 2);
  });
  it("coarseGroups partitions youth/young/mid/mature/senior (Σ over sex)", () => {
    const g = coarseGroups(uniform(100));
    // youth 0-17 = 18 ages × 100 × 2 sexes = 3600
    expect(g.youth).toBe(18 * 100 * 2);
    // young 18-29 = 12 ages, mid 30-44 = 15, mature 45-64 = 20, senior 65+ = 36 (65..100)
    expect(g.young).toBe(12 * 100 * 2);
    expect(g.mid).toBe(15 * 100 * 2);
    expect(g.mature).toBe(20 * 100 * 2);
    expect(g.senior).toBe(36 * 100 * 2);
    expect(g.young + g.mid + g.mature + g.senior + g.youth).toBe(totalPopulation(uniform(100)));
  });
  it("workingAge sums ages 18..64 over both sexes", () => {
    expect(workingAge(uniform(100))).toBe(47 * 100 * 2); // ages 18..64 inclusive
  });
  it("childbearing sums FEMALE ages 18..44 only (no ½ proxy)", () => {
    expect(childbearing(uniform(100))).toBe(27 * 100); // 18..44 female only
  });
  it("medianAgeFromVector returns the age where cumulative population crosses 50%", () => {
    expect(medianAgeFromVector(uniform(100))).toBe(50); // symmetric → 50
  });
  it("sexRatioFromVector returns share-male % (50 for a balanced vector)", () => {
    expect(sexRatioFromVector(uniform(100))).toBeCloseTo(50, 5);
  });
  it("dependencyRatio is (youth+senior)/workingAge", () => {
    const g = coarseGroups(uniform(100));
    const expected = (g.youth + g.senior) / workingAge(uniform(100));
    expect(dependencyRatio(uniform(100))).toBeCloseTo(expected, 9);
  });
  it("votingAgePopulation sums both sexes at or above the threshold (default 18)", () => {
    // uniform 100/age/sex → ages 18..100 = 83 ages × 100 × 2 = 16600
    expect(votingAgePopulation(uniform(100))).toBe(83 * 100 * 2);
    // threshold 16 → ages 16..100 = 85 ages
    expect(votingAgePopulation(uniform(100), 16)).toBe(85 * 100 * 2);
  });
  it("votingAgePopulation never exceeds total population", () => {
    expect(votingAgePopulation(uniform(100))).toBeLessThan(totalPopulation(uniform(100)));
  });
  it("workingAgePopulation sums both sexes in [lower, upper) (default 18..64)", () => {
    // uniform 100/age/sex → ages 18..63 = 46 ages × 100 × 2 = 9200
    expect(workingAgePopulation(uniform(100))).toBe(46 * 100 * 2);
    // explicit band 20..60 → ages 20..59 = 40 ages
    expect(workingAgePopulation(uniform(100), 20, 60)).toBe(40 * 100 * 2);
  });
  it("workingAgePopulation ≤ votingAgePopulation ≤ total", () => {
    const v = uniform(100);
    expect(workingAgePopulation(v)).toBeLessThanOrEqual(votingAgePopulation(v));
    expect(votingAgePopulation(v)).toBeLessThan(totalPopulation(v));
  });
  it("handles an empty vector without NaN/Infinity", () => {
    const empty: AgeSexVector = {
      male: Array.from({ length: 101 }, () => 0),
      female: Array.from({ length: 101 }, () => 0),
    };
    expect(totalPopulation(empty)).toBe(0);
    expect(sexRatioFromVector(empty)).toBe(50); // no population → neutral
    expect(dependencyRatio(empty)).toBe(0); // no workforce → 0, not Infinity
    expect(medianAgeFromVector(empty)).toBe(0);
  });
});
