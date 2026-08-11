import { describe, it, expect } from "vitest";
import { syntheticTickRate } from "./stateTickRates";

const opts = [
  { id: "max", effectDirection: 1 },
  { id: "mod", effectDirection: 1 },
  { id: "less", effectDirection: 1 },
  { id: "center", effectDirection: 0 },
  { id: "cut", effectDirection: -1 },
];

describe("syntheticTickRate — graded", () => {
  const common = {
    weight: 1,
    scopeMultiplier: 1,
    isHigherBetter: true,
    minValue: 0,
    maxValue: 100,
    referenceValue: 50,
  };
  it("Maximum > Moderate for a same-side same-metric law", () => {
    const max = syntheticTickRate({ options: opts, optionIndex: 0, ...common });
    const mod = syntheticTickRate({ options: opts, optionIndex: 2, ...common });
    expect(Math.abs(max)).toBeGreaterThan(Math.abs(mod));
  });
  it("center option → 0", () => {
    expect(syntheticTickRate({ options: opts, optionIndex: 3, ...common })).toBe(0);
  });
  it("scales a large-range metric by its operating value, not its bound", () => {
    const idx = {
      options: opts,
      optionIndex: 0,
      weight: 1,
      scopeMultiplier: 1,
      isHigherBetter: true,
    };
    const indexRate = syntheticTickRate({ ...idx, minValue: 0, maxValue: 100, referenceValue: 50 });
    // Large metric operating at ~13k → scaled by ~130× the index rate, not by the 10M bound.
    const currencyRate = syntheticTickRate({
      ...idx,
      minValue: 0,
      maxValue: 10_000_000,
      referenceValue: 13_000,
    });
    expect(Math.abs(currencyRate)).toBeGreaterThan(Math.abs(indexRate));
    expect(Math.abs(currencyRate / indexRate)).toBeCloseTo(130, 0);
  });
});
