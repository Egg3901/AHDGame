import { describe, expect, it } from "vitest";
import { populationWeightedAverage } from "./populationWeightedAverage";

describe("populationWeightedAverage", () => {
  it("weights values by population", () => {
    const r = populationWeightedAverage([
      { value: 10, population: 3_000_000 },
      { value: 2, population: 1_000_000 },
    ]);
    expect(r.value).toBe(8);
    expect(r.coveredPopulation).toBe(4_000_000);
  });

  it("divides by covered population, not total population", () => {
    // The second region carries no value. Its population must leave the
    // denominator, otherwise the average is diluted toward zero.
    const r = populationWeightedAverage([
      { value: 10, population: 1_000_000 },
      { population: 9_000_000 },
    ]);
    expect(r.value).toBe(10);
    expect(r.coveredPopulation).toBe(1_000_000);
  });

  it("weights trend on the same basis and defaults a missing trend to zero", () => {
    const r = populationWeightedAverage([
      { value: 5, trend: 2, population: 1_000_000 },
      { value: 5, population: 1_000_000 },
    ]);
    expect(r.trend).toBe(1);
  });

  it("returns nulls when nothing is covered", () => {
    const r = populationWeightedAverage([{ population: 5_000_000 }]);
    expect(r.value).toBeNull();
    expect(r.trend).toBeNull();
    expect(r.coveredPopulation).toBe(0);
  });

  it("ignores rows with zero population without breaking the average", () => {
    const r = populationWeightedAverage([
      { value: 10, population: 1_000_000 },
      { value: 999, population: 0 },
    ]);
    expect(r.value).toBe(10);
  });

  it("ignores a non-finite value rather than propagating NaN", () => {
    const r = populationWeightedAverage([
      { value: 10, population: 1_000_000 },
      { value: Number.NaN, population: 1_000_000 },
    ]);
    expect(r.value).toBe(10);
    expect(r.coveredPopulation).toBe(1_000_000);
  });

  it("returns nulls for an empty list", () => {
    const r = populationWeightedAverage([]);
    expect(r.value).toBeNull();
    expect(r.coveredPopulation).toBe(0);
  });
});
