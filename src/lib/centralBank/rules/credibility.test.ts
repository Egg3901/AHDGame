import { describe, expect, it } from "vitest";
import { stanceMatchesTaylorTarget } from "./credibility";

describe("stanceMatchesTaylorTarget", () => {
  const base = { neutralRate: 4.0, inflation: 2.0, targetInflation: 2.0, gdpGrowth: 12.0 };

  it("judges a player chair against the growth rule", () => {
    // 4.0 + 0 + 0.5*(12-2) = 9.0
    expect(stanceMatchesTaylorTarget({ ...base, primeRate: 9.0 })).toBe(true);
    expect(stanceMatchesTaylorTarget({ ...base, primeRate: 2.0 })).toBe(false);
  });

  it("judges an AI chair against the activity rule it follows", () => {
    // 4.0 + 0 + 0.5*0 - 0.5*clamp(12-5, -2, 4) = 2.0
    const activity = { outputGap: 0, unemploymentRate: 12 };
    expect(stanceMatchesTaylorTarget({ ...base, primeRate: 2.0, activity })).toBe(true);
    expect(stanceMatchesTaylorTarget({ ...base, primeRate: 9.0, activity })).toBe(false);
  });
});
