import { describe, expect, it } from "vitest";
import { synthesizeAgeSexVector } from "./seedSynthesis";
import { totalPopulation, coarseGroups, childbearing, medianAgeFromVector } from "./cohortVector";

const input = {
  adultShares: { young: 0.25, mid: 0.27, mature: 0.3, senior: 0.18 }, // sums to 1 (of adults)
  medianAge: 38,
  birthRate: 50, // 0-100 index
  population: 1_000_000,
};

describe("synthesizeAgeSexVector (§S4)", () => {
  it("scales to the target total population (within rounding)", () => {
    const v = synthesizeAgeSexVector(input);
    expect(totalPopulation(v)).toBeCloseTo(1_000_000, -2); // within ~100
  });
  it("reproduces the coarse 18+ shares it was given (within tolerance)", () => {
    const v = synthesizeAgeSexVector(input);
    const g = coarseGroups(v);
    const adults = g.young + g.mid + g.mature + g.senior;
    expect(g.young / adults).toBeCloseTo(0.25, 1);
    expect(g.senior / adults).toBeCloseTo(0.18, 1);
  });
  it("synthesizes a non-empty 0-17 youth block", () => {
    expect(coarseGroups(synthesizeAgeSexVector(input)).youth).toBeGreaterThan(0);
  });
  it("produces a realistic sex split (M:F ~1.05 at birth, female-majority old tail)", () => {
    const v = synthesizeAgeSexVector(input);
    expect(v.male[0] / v.female[0]).toBeCloseTo(1.05, 1);
    expect(v.female[95]).toBeGreaterThan(v.male[95]);
  });
  it("childbearing pool (female 18-44) is positive and < total females", () => {
    const v = synthesizeAgeSexVector(input);
    const totalFemale = v.female.reduce((a, b) => a + b, 0);
    const cb = childbearing(v);
    expect(cb).toBeGreaterThan(0);
    expect(cb).toBeLessThan(totalFemale);
  });
  it("accepts census-style integer shares (sum ~100) as well as fractions", () => {
    const intShares = synthesizeAgeSexVector({
      ...input,
      adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
    });
    const g = coarseGroups(intShares);
    const adults = g.young + g.mid + g.mature + g.senior;
    expect(g.young / adults).toBeCloseTo(0.25, 1);
    expect(totalPopulation(intShares)).toBeCloseTo(1_000_000, -2);
  });
  it("a higher birth rate yields a larger youth block", () => {
    const low = coarseGroups(synthesizeAgeSexVector({ ...input, birthRate: 10 })).youth;
    const high = coarseGroups(synthesizeAgeSexVector({ ...input, birthRate: 90 })).youth;
    expect(high).toBeGreaterThan(low);
  });
  it("every cell is non-negative and finite, vectors are length 101", () => {
    const v = synthesizeAgeSexVector(input);
    expect(v.male).toHaveLength(101);
    expect(v.female).toHaveLength(101);
    for (const cell of [...v.male, ...v.female]) {
      expect(Number.isFinite(cell)).toBe(true);
      expect(cell).toBeGreaterThanOrEqual(0);
    }
  });
  it("degrades gracefully on a zero population (all-zero vector)", () => {
    const v = synthesizeAgeSexVector({ ...input, population: 0 });
    expect(totalPopulation(v)).toBe(0);
    expect(v.male).toHaveLength(101);
  });
});

/**
 * The 0-17 block is the dominant determinant of the pyramid's median age, so it
 * is SOLVED against the seeded median rather than read off the birth-rate index
 * alone. Before this, the youth block was capped at 35% of the population — a
 * moderately young MODERN society — and every high-fertility seed synthesized a
 * median 6-8 years older than authored (1953 Nigeria read 24.4 against an
 * authored 16-19, Turkey 26.5 against 20, Brazil 25.9 against 17-21).
 */
describe("seed pyramid honours the seeded median age", () => {
  const youngCountry = { young: 34, mid: 30, mature: 26, senior: 10 };
  const agedCountry = { young: 22, mid: 26, mature: 32, senior: 20 };

  it("reports back the median age it was seeded with, young or old", () => {
    for (const [shares, medianAge, birthRate] of [
      [youngCountry, 18, 87], // 1953 Nigeria
      [youngCountry, 19, 77], // 1953 Brazil
      [agedCountry, 30, 55],
      [agedCountry, 38, 50],
      [agedCountry, 42, 20], // aged, low fertility
    ] as const) {
      const v = synthesizeAgeSexVector({
        adultShares: shares,
        medianAge,
        birthRate,
        population: 1e6,
      });
      expect(medianAgeFromVector(v)).toBeCloseTo(medianAge, 1);
    }
  });

  it("a high-fertility 1953 country synthesizes a genuinely young pyramid", () => {
    for (const [name, medianAge, birthRate] of [
      ["Nigeria", 18, 87],
      ["Turkey", 20, 55],
      ["Brazil", 19, 77],
    ] as const) {
      const v = synthesizeAgeSexVector({
        adultShares: youngCountry,
        medianAge,
        birthRate,
        population: 1e6,
      });
      const median = medianAgeFromVector(v);
      const youthShare = coarseGroups(v).youth / totalPopulation(v);
      expect(median, `${name} median`).toBeLessThan(24);
      // Real 1953 under-18 shares were ~45-48%; the old 0.35 ceiling made that
      // unrepresentable. Turkey's birth-rate index disagrees with its median, so
      // it is envelope-clamped and lands a little short of the others.
      expect(youthShare, `${name} youth share`).toBeGreaterThan(0.4);
    }
  });

  it("keeps the youth block inside plausible bounds even for an absurd median", () => {
    for (const medianAge of [1, 5, 70, 99]) {
      const v = synthesizeAgeSexVector({
        adultShares: agedCountry,
        medianAge,
        birthRate: 50,
        population: 1e6,
      });
      const youthShare = coarseGroups(v).youth / totalPopulation(v);
      expect(youthShare).toBeGreaterThanOrEqual(0.08);
      expect(youthShare).toBeLessThanOrEqual(0.55);
      expect(totalPopulation(v)).toBeCloseTo(1e6, -2);
    }
  });

  it("the birth-rate index still bounds the solve when it disagrees with the median", () => {
    // Same seeded median, opposite birth-rate readings: the envelope pulls the
    // youth block with the birth rate rather than letting the median dictate alone.
    const lowBr = synthesizeAgeSexVector({
      adultShares: youngCountry,
      medianAge: 18,
      birthRate: 20,
      population: 1e6,
    });
    const highBr = synthesizeAgeSexVector({
      adultShares: youngCountry,
      medianAge: 18,
      birthRate: 90,
      population: 1e6,
    });
    expect(coarseGroups(lowBr).youth).toBeLessThan(coarseGroups(highBr).youth);
  });
});
