import { describe, expect, it } from "vitest";
import { getFoundingConfidenceMultiplier } from "./foundingCosts";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

describe("getFoundingConfidenceMultiplier", () => {
  it("is 1.0 at/above baseline (no penalty)", () => {
    expect(getFoundingConfidenceMultiplier(INVESTOR_CONFIDENCE_BASELINE)).toBe(1);
    expect(getFoundingConfidenceMultiplier(95)).toBe(1);
  });
  it("rises above 1 as confidence falls", () => {
    expect(getFoundingConfidenceMultiplier(35)).toBeGreaterThan(1);
    expect(getFoundingConfidenceMultiplier(0)).toBeGreaterThan(getFoundingConfidenceMultiplier(35));
  });
  it("treats null/undefined as baseline", () => {
    expect(getFoundingConfidenceMultiplier(null)).toBe(1);
    expect(getFoundingConfidenceMultiplier(undefined)).toBe(1);
  });
});
