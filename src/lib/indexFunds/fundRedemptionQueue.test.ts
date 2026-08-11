import { describe, expect, it } from "vitest";
import {
  isRetryableRedemptionEntry,
  redemptionEntryStatusAfterPayout,
  remainingRedemptionUnits,
} from "./fundRedemptionQueue";

describe("fundRedemptionQueue", () => {
  it("treats entry.units as the remaining unpaid units", () => {
    expect(
      remainingRedemptionUnits({
        units: 5,
      })
    ).toBe(5);
  });

  it("does not subtract historical paidAmountAnchor a second time", () => {
    expect(
      remainingRedemptionUnits({
        units: 5,
        paidAmountAnchor: 500,
        requestedNavAnchor: 100,
      })
    ).toBe(5);
  });

  it("treats partial entries as retryable until fully paid", () => {
    expect(
      isRetryableRedemptionEntry({
        status: "partial",
        units: 4,
        paidAmountAnchor: 600,
        requestedNavAnchor: 100,
      })
    ).toBe(true);
    expect(
      isRetryableRedemptionEntry({
        status: "paid",
        units: 0,
        paidAmountAnchor: 1000,
        requestedNavAnchor: 100,
      })
    ).toBe(false);
  });

  it("returns partial status when units remain after a payout (ticket #857)", () => {
    // This is only called after a successful nonzero payout, so a nonzero
    // remainder means "partially paid," not "untouched" — "queued" would be
    // indistinguishable from a fresh request that's never been paid at all.
    expect(redemptionEntryStatusAfterPayout(3)).toBe("partial");
    expect(redemptionEntryStatusAfterPayout(0)).toBe("paid");
  });
});
