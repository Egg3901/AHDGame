import { describe, expect, it } from "vitest";
import {
  regionAttractiveness,
  computeInternalNetTargets,
  applyInternalMigration,
  type RegionPullMetrics,
} from "./internalMigration";
import { migrantAgeSexProfile } from "./internationalMigration";
import { synthesizeAgeSexVector } from "../seedSynthesis";
import { totalPopulation, type AgeSexVector } from "../cohortVector";

/**
 * Multi-region internal-migration stability (`__sim__`): over many turns across a
 * 3-region country, the national total is conserved exactly (N1), no cell ever
 * goes negative (F-B), population concentrates toward the attractive region, and
 * the system converges (no region absorbs the whole country / runs away).
 */
const TPY = 48;
const profile = migrantAgeSexProfile(0.5);
const seed = (pop: number) =>
  synthesizeAgeSexVector({
    adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
    medianAge: 38,
    birthRate: 50,
    population: pop,
  });

// A = attractive, B = neutral, C = unattractive (fixed metrics).
const metrics: Record<string, RegionPullMetrics> = {
  A: { gdpGrowth: 5, unemployment: 3, medianIncome: 60000, costOfLiving: 45 },
  B: { gdpGrowth: 2.5, unemployment: 5, medianIncome: 50000, costOfLiving: 50 },
  C: { gdpGrowth: 0, unemployment: 9, medianIncome: 40000, costOfLiving: 55 },
};

describe("internal migration (__sim__)", () => {
  it("conserves the national total exactly, keeps cells ≥ 0, concentrates toward the attractive region", () => {
    let vectors = new Map<string, AgeSexVector>([
      ["A", seed(1_000_000)],
      ["B", seed(1_000_000)],
      ["C", seed(1_000_000)],
    ]);
    const national = () => [...vectors.values()].reduce((s, v) => s + totalPopulation(v), 0);
    const start = national();
    const avgIncome = 50000;

    for (let t = 0; t < 5 * TPY; t++) {
      const attract = new Map(
        [...vectors.keys()].map((id) => [id, regionAttractiveness(metrics[id], avgIncome)])
      );
      const pop = new Map([...vectors.entries()].map(([id, v]) => [id, totalPopulation(v)]));
      const targets = computeInternalNetTargets(attract, pop, TPY);
      const { vectors: next } = applyInternalMigration(vectors, targets, profile, 0.05);
      vectors = next;
      expect(national()).toBeCloseTo(start, 0); // N1 every turn
      for (const v of vectors.values())
        for (const cell of [...v.male, ...v.female]) expect(cell).toBeGreaterThanOrEqual(0); // F-B
    }
    // Attractive A gained share; unattractive C lost it.
    expect(totalPopulation(vectors.get("A")!)).toBeGreaterThan(1_000_000);
    expect(totalPopulation(vectors.get("C")!)).toBeLessThan(1_000_000);
    // No runaway: A did not absorb the entire country in 5 years.
    expect(totalPopulation(vectors.get("A")!)).toBeLessThan(1_500_000);
  });
});
