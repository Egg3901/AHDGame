import { describe, it, expect } from "vitest";
import { aggregateNationalGdp } from "./nationalGdp";

describe("aggregateNationalGdp", () => {
  it("sums state gdp (millions) and computes per-capita in base units", () => {
    const r = aggregateNationalGdp([
      { gdp: 1000, population: 2_000_000 },
      { gdp: 500, population: 1_000_000 },
    ]);
    expect(r.gdpMillions).toBe(1500);
    // (1500e6) / 3e6 = 500
    expect(Math.round(r.perCapita)).toBe(500);
  });

  it("treats missing gdp as zero", () => {
    const r = aggregateNationalGdp([
      { population: 1_000_000 },
      { gdp: 200, population: 1_000_000 },
    ]);
    expect(r.gdpMillions).toBe(200);
  });

  it("handles zero population safely", () => {
    expect(aggregateNationalGdp([{ gdp: 10, population: 0 }]).perCapita).toBe(0);
  });

  it("handles an empty list", () => {
    const r = aggregateNationalGdp([]);
    expect(r.gdpMillions).toBe(0);
    expect(r.perCapita).toBe(0);
  });
});
