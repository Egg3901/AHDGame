import { describe, expect, it } from "vitest";
import { apportionRegionPopulation } from "./apportionRegionPopulation";

describe("apportionRegionPopulation", () => {
  it("preserves shares and assigns every person deterministically", () => {
    expect(
      apportionRegionPopulation(
        [
          { id: "B", population: 2 },
          { id: "A", population: 1 },
          { id: "C", population: 1 },
        ],
        11
      )
    ).toEqual([
      { id: "B", population: 5 },
      { id: "A", population: 3 },
      { id: "C", population: 3 },
    ]);
  });

  it("rejects unusable population inputs", () => {
    expect(() => apportionRegionPopulation([{ id: "A", population: 0 }], 100)).toThrow();
    expect(() => apportionRegionPopulation([{ id: "A", population: 1 }], -1)).toThrow();
  });
});
