import { describe, expect, it } from "vitest";
import { allocatePopulationTotal } from "./populationAllocation";

describe("population allocation", () => {
  it("conserves the national total, preserves shares within one person and leaves its input intact", () => {
    const regions = [
      { _id: "A", population: 11, gdp: 120 },
      { _id: "B", population: 7, gdp: 90 },
      { _id: "C", population: 3, gdp: 30 },
    ];
    const original = structuredClone(regions);
    for (const total of [1, 20, 21, 100, 1_158_230_000]) {
      const result = allocatePopulationTotal(regions, total);
      expect(result.reduce((sum, region) => sum + region.population, 0)).toBe(total);
      for (let index = 0; index < result.length; index++) {
        expect(
          Math.abs(result[index].population - (regions[index].population / 21) * total)
        ).toBeLessThan(1);
        expect(result[index].gdp).toBe(regions[index].gdp);
      }
      expect(regions).toEqual(original);
    }
  });
  it("resolves equal remainders by id independent of input order", () => {
    const regions = [
      { _id: "B", population: 1 },
      { _id: "A", population: 1 },
    ];
    expect(allocatePopulationTotal(regions, 3)).toEqual([
      { _id: "B", population: 1 },
      { _id: "A", population: 2 },
    ]);
    expect(allocatePopulationTotal([...regions].reverse(), 3)).toEqual([
      { _id: "A", population: 2 },
      { _id: "B", population: 1 },
    ]);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid total %s",
    (total) => {
      expect(() => allocatePopulationTotal([{ _id: "A", population: 1 }], total)).toThrow();
    }
  );
  it("rejects invalid or duplicate regional inputs", () => {
    expect(() => allocatePopulationTotal([], 10)).toThrow();
    expect(() => allocatePopulationTotal([{ _id: "A", population: 0 }], 10)).toThrow();
    expect(() => allocatePopulationTotal([{ _id: "A", population: 1.5 }], 10)).toThrow();
    expect(() =>
      allocatePopulationTotal(
        [
          { _id: "A", population: 1 },
          { _id: "A", population: 2 },
        ],
        10
      )
    ).toThrow();
    expect(() =>
      allocatePopulationTotal(
        [
          { _id: "A", population: Number.MAX_SAFE_INTEGER },
          { _id: "B", population: 1 },
        ],
        10
      )
    ).toThrow();
  });
});
