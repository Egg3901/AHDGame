import { describe, expect, it } from "vitest";
import { compoundGdpLevel, smoothNationalGdp } from "./gdpLevel";

describe("compoundGdpLevel", () => {
  it("compounds by the per-turn root so 48 turns ≈ one annual rate", () => {
    let gdp = 1000;
    for (let t = 0; t < 48; t++) gdp = compoundGdpLevel(gdp, 3, 48);
    expect(gdp).toBeCloseTo(1030, 0); // +3% over a full year
  });

  it("is exact-form (1+r)^(1/n), not 1+r/n", () => {
    expect(compoundGdpLevel(1000, 3, 48)).toBeCloseTo(1000 * 1.03 ** (1 / 48), 6);
    // and distinct from the naive 1 + r/n form
    expect(compoundGdpLevel(1000, 3, 48)).not.toBeCloseTo(1000 * (1 + 0.03 / 48), 6);
  });

  it("shrinks the level on negative growth", () => {
    expect(compoundGdpLevel(1000, -6, 48)).toBeLessThan(1000);
  });

  it("floors at a small positive value and rejects non-finite prev", () => {
    expect(compoundGdpLevel(0, 3, 48)).toBeGreaterThan(0);
    expect(compoundGdpLevel(Number.NaN, 3, 48)).toBeGreaterThan(0);
    expect(compoundGdpLevel(-100, 3, 48)).toBeGreaterThan(0);
  });

  it("treats non-finite growth as 0% (no change beyond floor)", () => {
    expect(compoundGdpLevel(1000, Number.NaN, 48)).toBeCloseTo(1000, 6);
  });
});

describe("smoothNationalGdp", () => {
  it("EMA toward the new value", () => {
    expect(smoothNationalGdp(1000, 2000, 0.9)).toBeCloseTo(1100, 6); // 0.9*1000 + 0.1*2000
  });

  it("cold-starts to the current value when no prior", () => {
    expect(smoothNationalGdp(undefined, 2000, 0.9)).toBe(2000);
  });

  it("rejects a non-finite prior (cold-start)", () => {
    expect(smoothNationalGdp(Number.NaN, 2000, 0.9)).toBe(2000);
  });
});
