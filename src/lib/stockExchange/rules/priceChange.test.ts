import { describe, expect, it } from "vitest";
import { splitAdjustedPriceChange } from "./priceChange";
describe("reported price return", () => {
  it("does not turn dilution into a price gain when no split was recorded", () => {
    expect(splitAdjustedPriceChange(70, { price: 100, turn: 10 }, [])).toBe(-30);
  });
  it("adjusts forward and reverse splits without hiding subsequent price changes", () => {
    expect(
      splitAdjustedPriceChange(55, { price: 100, turn: 10 }, [
        { turn: 11, oldShares: 100, newShares: 200 },
      ])
    ).toBe(10);
    expect(
      splitAdjustedPriceChange(210, { price: 100, turn: 10 }, [
        { turn: 11, oldShares: 200, newShares: 100 },
      ])
    ).toBe(5);
  });
  it("does not adjust a split already reflected in the historical snapshot", () => {
    expect(
      splitAdjustedPriceChange(55, { price: 50, turn: 10, timestamp: 200 }, [
        { turn: 10, timestamp: 100, oldShares: 100, newShares: 200 },
      ])
    ).toBe(10);
    expect(
      splitAdjustedPriceChange(50, { price: 100, turn: 10, timestamp: 100 }, [
        { turn: 10, timestamp: 200, oldShares: 100, newShares: 200 },
      ])
    ).toBe(0);
  });
});
