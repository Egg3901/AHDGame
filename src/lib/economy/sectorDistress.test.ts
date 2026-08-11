import { describe, it, expect } from "vitest";
import { distressRankingToBoostMap, type SectorDistressScore } from "./sectorDistress";
import type { CorporationType } from "@/lib/constants/corporations";

const score = (sectorType: string, distress: number, rank: number): SectorDistressScore => ({
  sectorType: sectorType as CorporationType,
  distress,
  rank,
});

describe("distressRankingToBoostMap (magnitude-weighted)", () => {
  it("gives the most-distressed sector the full maxBoost", () => {
    const ranking = [score("a", 0.5, 0), score("b", 0.25, 1), score("c", 0.1, 2)];
    const map = distressRankingToBoostMap(ranking, 1);
    expect(map.get("a" as CorporationType)).toBeCloseTo(1);
  });

  it("scales other sectors by true distress magnitude, not rank position", () => {
    const ranking = [score("a", 0.5, 0), score("b", 0.25, 1), score("c", 0.05, 2)];
    const map = distressRankingToBoostMap(ranking, 1);
    // b is half as distressed as a → half the boost; c is a tenth → a tenth.
    expect(map.get("b" as CorporationType)).toBeCloseTo(0.5);
    expect(map.get("c" as CorporationType)).toBeCloseTo(0.1);
  });

  it("zeroes out non-distressed (healthy / oversupplied) sectors", () => {
    const ranking = [score("a", 0.4, 0), score("b", 0, 1), score("c", -0.3, 2)];
    const map = distressRankingToBoostMap(ranking, 2);
    expect(map.get("a" as CorporationType)).toBeCloseTo(2);
    expect(map.get("b" as CorporationType)).toBe(0);
    expect(map.get("c" as CorporationType)).toBe(0);
  });

  it("seeds nothing when no sector is distressed", () => {
    const ranking = [score("a", 0, 0), score("b", -0.2, 1)];
    const map = distressRankingToBoostMap(ranking, 1);
    expect([...map.values()].every((v) => v === 0)).toBe(true);
  });

  it("respects the maxBoost ceiling", () => {
    const ranking = [score("a", 0.3, 0), score("b", 0.15, 1)];
    const map = distressRankingToBoostMap(ranking, 0.25);
    expect(map.get("a" as CorporationType)).toBeCloseTo(0.25);
    expect(map.get("b" as CorporationType)).toBeCloseTo(0.125);
  });
});
