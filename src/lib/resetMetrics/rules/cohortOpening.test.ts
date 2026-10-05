import { describe, expect, it } from "vitest";
import { dependencyBurden15To64, openingDependencyCohorts } from "./cohortOpening";

describe("1991 opening dependency cohorts", () => {
  it("uses 15-64 rather than the old 18-64 demographic band", () => {
    const male = Array(101).fill(0) as number[];
    const female = Array(101).fill(0) as number[];
    male[14] = 10;
    male[15] = 20;
    female[17] = 30;
    female[64] = 40;
    male[65] = 50;
    expect(openingDependencyCohorts({ male, female })).toEqual({
      populationUnder15: 10,
      population15To64: 90,
      population65Plus: 50,
    });
  });

  it("rejects missing or negative stock instead of opening at zero", () => {
    expect(() => openingDependencyCohorts({ male: [], female: [] })).toThrow();
    expect(() =>
      openingDependencyCohorts({ male: Array(101).fill(-1), female: Array(101).fill(0) })
    ).toThrow();
  });

  it("recomputes a live 15-64 dependency burden without rounding cohort flows", () => {
    const male = Array(101).fill(0) as number[];
    const female = Array(101).fill(0) as number[];
    male[14] = 10.5;
    female[15] = 40.25;
    male[64] = 59.75;
    female[65] = 39.5;
    expect(dependencyBurden15To64({ male, female })).toBe(50);
    expect(() => dependencyBurden15To64({ male: [], female: [] })).toThrow();
  });
});
