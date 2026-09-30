import { describe, expect, it } from "vitest";
import { onboardingRewardLocalAmount } from "./rules";

describe("onboardingRewardLocalAmount", () => {
  it("matches the 2027 EUR credit at the shared DE exchange rate", () => {
    expect(onboardingRewardLocalAmount(50_000, true, "EUR", 0.92, "2027-default")).toBe(46_000);
  });

  it("uses the preset's EUR seed rate when the live rate is missing or invalid", () => {
    const missing = onboardingRewardLocalAmount(50_000, true, "EUR", undefined, "2027-default");
    expect(missing).toBeGreaterThan(0);
    expect(onboardingRewardLocalAmount(50_000, true, "EUR", 0, "2027-default")).toBe(missing);
    expect(
      onboardingRewardLocalAmount(50_000, true, "EUR", Number.POSITIVE_INFINITY, "2027-default")
    ).toBe(missing);
  });

  it("keeps the anchor amount when forex is disabled", () => {
    expect(onboardingRewardLocalAmount(50_000, false, "EUR", 0.92, "2027-default")).toBe(50_000);
  });
});
