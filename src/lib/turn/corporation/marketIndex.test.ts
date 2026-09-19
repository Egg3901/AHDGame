import { describe, expect, it } from "vitest";
import { computeMarketIndex } from "./marketIndex";

describe("computeMarketIndex", () => {
  it("keeps the index continuous when a constituent is removed", () => {
    expect(
      computeMarketIndex({
        currentMarketCap: 50,
        previousMarketCap: 100,
        previousSurvivorMarketCap: 50,
        previousIndex: 100,
        previousDivisor: 1,
      })
    ).toEqual({
      index: 100,
      divisor: 0.5,
      removedMarketCap: 50,
    });
  });

  it("moves with surviving constituents after a removal", () => {
    expect(
      computeMarketIndex({
        currentMarketCap: 60,
        previousMarketCap: 100,
        previousSurvivorMarketCap: 50,
        previousIndex: 100,
        previousDivisor: 1,
      })
    ).toEqual({
      index: 120,
      divisor: 0.5,
      removedMarketCap: 50,
    });
  });

  it("does not invent a removal when survivor history is unavailable", () => {
    expect(
      computeMarketIndex({
        currentMarketCap: 80,
        previousMarketCap: 100,
        previousIndex: 100,
        previousDivisor: 1,
      })
    ).toEqual({
      index: 80,
      divisor: 1,
      removedMarketCap: 0,
    });
  });
});
