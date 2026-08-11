import { describe, expect, it } from "vitest";
import { getExpropriationRiskMarginModifier } from "./corporations";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

describe("getExpropriationRiskMarginModifier", () => {
  it("is zero at or above baseline confidence", () => {
    expect(getExpropriationRiskMarginModifier(INVESTOR_CONFIDENCE_BASELINE)).toBe(0);
    expect(getExpropriationRiskMarginModifier(90)).toBe(0);
  });
  it("is negative below baseline, worst at 0", () => {
    const mid = getExpropriationRiskMarginModifier(35);
    const worst = getExpropriationRiskMarginModifier(0);
    expect(mid).toBeLessThan(0);
    expect(worst).toBeLessThan(mid);
  });
  it("treats null/undefined as baseline (no drag)", () => {
    expect(getExpropriationRiskMarginModifier(null)).toBe(0);
    expect(getExpropriationRiskMarginModifier(undefined)).toBe(0);
  });
});
