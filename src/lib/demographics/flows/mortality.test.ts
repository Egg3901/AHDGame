import { describe, expect, it } from "vitest";
import { perAgeMortality, healthcareMortalityModifier, applyMortality } from "./mortality";
import type { AgeSexVector } from "../cohortVector";

const TPY = 48;
function flat(perCell = 1000): AgeSexVector {
  const arr = () => Array.from({ length: 101 }, () => perCell);
  return { male: arr(), female: arr() };
}

describe("perAgeMortality", () => {
  it("rises monotonically with age", () => {
    for (let a = 1; a <= 100; a++) {
      expect(perAgeMortality("male", a)).toBeGreaterThanOrEqual(perAgeMortality("male", a - 1));
    }
  });
  it("female mortality is below male at every age (longer life expectancy)", () => {
    for (let a = 0; a <= 100; a++) {
      expect(perAgeMortality("female", a)).toBeLessThan(perAgeMortality("male", a) + 1e-9);
    }
  });
  it("young-adult rate is low (<0.3%/yr) and the 100+ terminal is high (>=30%/yr)", () => {
    expect(perAgeMortality("male", 25)).toBeLessThan(0.003);
    expect(perAgeMortality("male", 100)).toBeGreaterThanOrEqual(0.3);
  });
});

describe("healthcareMortalityModifier (REAL units: years / per-100k)", () => {
  it("is ~1 at the realistic mid-range (lifeExpectancy 77.5y, preventableMortality 310/100k)", () => {
    expect(
      healthcareMortalityModifier({ lifeExpectancy: 77.5, preventableMortality: 310 })
    ).toBeCloseTo(1, 1);
  });
  it("good healthcare lowers the modifier; bad raises it; clamped to [0.7,1.4]", () => {
    const good = healthcareMortalityModifier({ lifeExpectancy: 85, preventableMortality: 120 });
    const bad = healthcareMortalityModifier({ lifeExpectancy: 70, preventableMortality: 500 });
    expect(good).toBeLessThan(1);
    expect(good).toBeGreaterThanOrEqual(0.7);
    expect(bad).toBeGreaterThan(1);
    expect(bad).toBeLessThanOrEqual(1.4);
  });
  it("seeded regions map sensibly (pre-fix, per-100k values pegged EVERYTHING at the 1.4 max)", () => {
    // JP-tier excellence (84y, 180/100k): mortality REDUCTION — may legitimately
    // reach the 0.7 floor (the designed "bends, never abolishes" cap), never 1.4.
    const jp = healthcareMortalityModifier({ lifeExpectancy: 84, preventableMortality: 180 });
    expect(jp).toBeLessThan(1);
    expect(jp).toBeGreaterThanOrEqual(0.7);
    // A mid-tier region (78y, 300/100k) sits INTERIOR near neutral — the modifier
    // differentiates across the realistic range instead of saturating one end.
    const mid = healthcareMortalityModifier({ lifeExpectancy: 78, preventableMortality: 300 });
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeLessThan(1.1);
  });
  it("missing metrics default to the neutral mid (modifier 1)", () => {
    expect(healthcareMortalityModifier({})).toBeCloseTo(1, 5);
  });
});

describe("applyMortality", () => {
  it("removes deaths per cell, never more than the cohort, returns survivors + deaths total", () => {
    const { survivors, deaths } = applyMortality(flat(1000), 1, TPY);
    expect(deaths).toBeGreaterThan(0);
    for (let a = 0; a <= 100; a++) {
      expect(survivors.male[a]).toBeLessThanOrEqual(1000);
      expect(survivors.male[a]).toBeGreaterThanOrEqual(0);
    }
    // per-turn fraction: a young cell loses far less than 1 person of 1000
    expect(survivors.male[25]).toBeGreaterThan(999);
  });
  it("a higher modifier kills more", () => {
    const low = applyMortality(flat(1000), 0.7, TPY).deaths;
    const high = applyMortality(flat(1000), 1.4, TPY).deaths;
    expect(high).toBeGreaterThan(low);
  });
});
