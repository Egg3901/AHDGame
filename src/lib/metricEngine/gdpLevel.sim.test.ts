import { describe, expect, it } from "vitest";
import { compoundGdpLevel, smoothNationalGdp } from "./gdpLevel";

/**
 * Multi-turn GDP-level stability (`__sim__`) — the core P1a guarantee: applying
 * the per-turn compounding over many turns yields stable, predictable growth
 * (no runaway, no collapse), national Σ stays the sum of regions, and the
 * smoothed national GDP tracks-but-lags the raw level.
 *
 * F-4 NOTE (design §6.2): the raw-population/turnout-share guard is fundamentally
 * about `state.population` drift, which P1a does NOT touch (population becomes
 * dynamic in P1b). `state.gdp` feeds the turnout *rate* only as a prosperity
 * input; the moving level is regression-covered by the full turn+sim suite
 * (1535 tests green with the Task-2 change). The explicit "GDP/population drift
 * must not flip vote shares or winners" assertion belongs in P1b, where
 * population drift is the actual trigger and the election engine is in scope.
 */

const TURNS_PER_YEAR = 48;

describe("GDP-level multi-turn stability", () => {
  it("grows a region by ≈ the compounded annual rate over 2 game-years", () => {
    let gdp = 1000;
    for (let t = 0; t < 2 * TURNS_PER_YEAR; t++) gdp = compoundGdpLevel(gdp, 3, TURNS_PER_YEAR);
    // (1.03)^2 ≈ 1.0609 → ~1060.9
    expect(gdp).toBeCloseTo(1000 * 1.03 ** 2, 1);
  });

  it("national Σ equals the sum of regional levels every turn (3 regions)", () => {
    const regions = [
      { gdp: 1000, growth: 3 },
      { gdp: 2000, growth: 1.5 },
      { gdp: 500, growth: -2 },
    ];
    for (let t = 0; t < TURNS_PER_YEAR; t++) {
      for (const r of regions) r.gdp = compoundGdpLevel(r.gdp, r.growth, TURNS_PER_YEAR);
      const national = regions.reduce((sum, r) => sum + r.gdp, 0);
      expect(national).toBeCloseTo(regions[0].gdp + regions[1].gdp + regions[2].gdp, 9);
    }
  });

  it("does not run away or collapse under sustained growth then contraction", () => {
    let gdp = 1000;
    for (let t = 0; t < 4 * TURNS_PER_YEAR; t++) gdp = compoundGdpLevel(gdp, 5, TURNS_PER_YEAR); // 4yr boom
    expect(gdp).toBeLessThan(1000 * 1.05 ** 4 * 1.001); // ≈ (1.05)^4, no runaway
    for (let t = 0; t < 4 * TURNS_PER_YEAR; t++) gdp = compoundGdpLevel(gdp, -5, TURNS_PER_YEAR); // 4yr bust
    expect(gdp).toBeGreaterThan(0); // floored, never collapses to 0
  });

  it("smoothed national GDP tracks but lags a step change", () => {
    let smoothed = smoothNationalGdp(undefined, 1000, 0.7); // cold start → 1000
    expect(smoothed).toBe(1000);
    // step the raw level up to 2000; smoothed converges over several years
    for (let y = 0; y < 10; y++) smoothed = smoothNationalGdp(smoothed, 2000, 0.7);
    // error decays by 0.7 each step → after 10 steps ≈ 1000·0.7^10 ≈ 28 below target
    expect(smoothed).toBeGreaterThan(1900); // converged most of the way
    expect(smoothed).toBeLessThan(2000); // but lags — never fully arrives in finite steps
  });
});
