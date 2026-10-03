import { describe, it, expect } from "vitest";
import { legacyAnchorPolicyCharge } from "./physicalPnl";

/**
 * P3.5 — legacy residual anchors carry the calibration-time policy stack.
 *
 * An anchor solved before `policyCredit` existed holds the stack as an amount
 * (revenue × stack/100). The charge-back returns exactly that amount at this
 * turn's revenue, so the stack is counted once beside `policyCredit`.
 */
describe("legacyAnchorPolicyCharge", () => {
  it("charges back revenue × the calibration-time stack", () => {
    // Base margin 35 (neutral basis 0.65), calibrated with +25.35 pp of
    // modifiers (stored basis 0.3965).
    expect(
      legacyAnchorPolicyCharge({
        hourlyRevenue: 1000,
        neutralBasis: 0.65,
        anchorMarginBasis: 0.3965,
      })
    ).toBeCloseTo(253.5, 8);
  });

  it("is a credit when the sector was calibrated under penalties", () => {
    expect(
      legacyAnchorPolicyCharge({ hourlyRevenue: 1000, neutralBasis: 0.88, anchorMarginBasis: 0.95 })
    ).toBeCloseTo(-70, 8);
  });

  it("is zero for anchors stamped at the neutral basis", () => {
    expect(
      legacyAnchorPolicyCharge({ hourlyRevenue: 1000, neutralBasis: 0.8, anchorMarginBasis: 0.8 })
    ).toBe(0);
  });

  it("is zero without a stored basis or with non-finite inputs", () => {
    for (const anchorMarginBasis of [undefined, null, Number.NaN]) {
      expect(
        legacyAnchorPolicyCharge({ hourlyRevenue: 1000, neutralBasis: 0.8, anchorMarginBasis })
      ).toBe(0);
    }
    expect(
      legacyAnchorPolicyCharge({
        hourlyRevenue: Number.NaN,
        neutralBasis: 0.8,
        anchorMarginBasis: 0.6,
      })
    ).toBe(0);
  });

  it("scales with revenue, so a mothballed or idle plant is charged nothing", () => {
    expect(
      legacyAnchorPolicyCharge({ hourlyRevenue: 0, neutralBasis: 0.65, anchorMarginBasis: 0.4 })
    ).toBe(0);
  });
});
