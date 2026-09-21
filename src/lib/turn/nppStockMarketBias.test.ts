import { describe, expect, it } from "vitest";

import { nppStockCandidateWeight } from "./nppActionProcessing";

describe("nppStockCandidateWeight", () => {
  it("keeps a blue-chip preference without allowing size to dominate the sample", () => {
    const small = nppStockCandidateWeight(1_000_000, 1, 1);
    const mega = nppStockCandidateWeight(100_000_000, 1, 1);

    expect(mega / small).toBeCloseTo(Math.sqrt(10));
  });

  it("lets stronger value offset a moderate size disadvantage", () => {
    const cheaperSmall = nppStockCandidateWeight(10_000_000, 1.5, 1.2);
    const expensiveLarge = nppStockCandidateWeight(40_000_000, 0.75, 1.2);

    expect(cheaperSmall).toBeGreaterThan(expensiveLarge);
  });

  it("returns a finite non-negative score for malformed inputs", () => {
    expect(nppStockCandidateWeight(Number.NaN, Number.NaN, Number.NaN)).toBe(1);
    expect(nppStockCandidateWeight(-100, -2, 1)).toBe(0);
  });
});
