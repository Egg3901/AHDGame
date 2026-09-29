import { describe, expect, it } from "vitest";
import { MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";
import { purchaseConversionRequired, purchaseConversionSpend } from "./purchaseConversion";

describe("purchase conversion funding", () => {
  it.each([0.5, 1, 1.5])("covers the actual source spread strength %s", (strength) => {
    const target = 100000;
    const rate = 0.8;
    const spend = purchaseConversionSpend(target, rate, 200000, false, strength);
    const fee = Math.round(spend * MARKET_MAKER_SPREAD * strength);
    expect(Math.round((spend - fee) * rate)).toBeGreaterThanOrEqual(target);
    expect(purchaseConversionRequired(target, rate, false, strength)).toBeCloseTo(
      target / ((1 - MARKET_MAKER_SPREAD * strength) * rate)
    );
  });
  it("caps spend at the wallet and preserves fee-free fixed settlement", () => {
    expect(purchaseConversionSpend(1000, 1, 500, false, 1.5)).toBe(500);
    expect(purchaseConversionSpend(1000, 4 / 3, 750, true, 1.5)).toBe(750);
    expect(purchaseConversionRequired(1000, 4 / 3, true, 1.5)).toBe(750);
  });
});
