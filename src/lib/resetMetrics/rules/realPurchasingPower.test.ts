import { describe, expect, it } from "vitest";
import { provisionalRealPurchasingPower } from "./realPurchasingPower";

describe("provisional real purchasing power", () => {
  it("returns annual real income in local currency and responds to income and prices", () => {
    expect(
      provisionalRealPurchasingPower({
        currentGrossIncome: 20_000,
        currentBasketIndex: 100,
      })
    ).toBe(20_000);
    expect(
      provisionalRealPurchasingPower({
        currentGrossIncome: 22_000,
        currentBasketIndex: 110,
      })
    ).toBeCloseTo(20_000);
    expect(
      provisionalRealPurchasingPower({
        currentGrossIncome: 22_000,
        currentBasketIndex: 100,
      })
    ).toBeCloseTo(22_000);
  });

  it("rejects missing or nonpositive bases instead of emitting a false zero", () => {
    expect(() =>
      provisionalRealPurchasingPower({
        currentGrossIncome: 0,
        currentBasketIndex: 100,
      })
    ).toThrow("positive finite");
  });
});
