import { describe, expect, it } from "vitest";
import { provisionalRealPurchasingPower } from "./realPurchasingPower";

describe("provisional real purchasing power", () => {
  const opening = {
    openingIndex: 100,
    openingGrossIncome: 20_000,
    openingBasketIndex: 100,
  };

  it("keeps the 1991 index as an anchor and responds to income and prices", () => {
    expect(
      provisionalRealPurchasingPower({
        ...opening,
        currentGrossIncome: 20_000,
        currentBasketIndex: 100,
      })
    ).toBe(100);
    expect(
      provisionalRealPurchasingPower({
        ...opening,
        currentGrossIncome: 22_000,
        currentBasketIndex: 110,
      })
    ).toBeCloseTo(100);
    expect(
      provisionalRealPurchasingPower({
        ...opening,
        currentGrossIncome: 22_000,
        currentBasketIndex: 100,
      })
    ).toBeCloseTo(110);
  });

  it("rejects missing or nonpositive bases instead of emitting a false zero", () => {
    expect(() =>
      provisionalRealPurchasingPower({
        ...opening,
        currentGrossIncome: 0,
        currentBasketIndex: 100,
      })
    ).toThrow("positive finite");
  });
});
