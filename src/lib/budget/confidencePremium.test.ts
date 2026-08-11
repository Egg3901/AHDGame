import { describe, expect, it } from "vitest";
import { getSovereignConfidencePremium } from "./debt";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

describe("getSovereignConfidencePremium", () => {
  it("is zero at/above baseline", () => {
    expect(getSovereignConfidencePremium(INVESTOR_CONFIDENCE_BASELINE)).toBe(0);
    expect(getSovereignConfidencePremium(85)).toBe(0);
  });
  it("rises as confidence falls, max at 0", () => {
    expect(getSovereignConfidencePremium(35)).toBeGreaterThan(0);
    expect(getSovereignConfidencePremium(0)).toBeGreaterThan(getSovereignConfidencePremium(35));
  });
  it("treats null/undefined as baseline", () => {
    expect(getSovereignConfidencePremium(null)).toBe(0);
    expect(getSovereignConfidencePremium(undefined)).toBe(0);
  });
});
