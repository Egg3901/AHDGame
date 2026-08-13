import { describe, it, expect } from "vitest";
import { feeDecision } from "./expenseFees";
import { FEE_SUSPENDED_BELOW_BACKING_RATIO, expenseFeeForTurn } from "./constants";

const base = {
  status: "active" as const,
  expenseRatioAnnual: 0.01,
  aumAnchor: 100_000_000,
  backingRatio: 1,
  cashAnchor: 100_000_000,
};

describe("feeDecision", () => {
  it("charges a healthy sponsored fund", () => {
    const { feeAnchor } = feeDecision(base);
    expect(feeAnchor).toBeCloseTo(expenseFeeForTurn(base.aumAnchor, base.expenseRatioAnnual), 6);
  });

  it("charges nothing on a system fund, which has no sponsor", () => {
    expect(feeDecision({ ...base, expenseRatioAnnual: undefined })).toEqual({
      feeAnchor: 0,
      reason: "not_sponsored",
    });
  });

  it("stops paying the sponsor once the holders are impaired", () => {
    const impaired = feeDecision({
      ...base,
      backingRatio: FEE_SUSPENDED_BELOW_BACKING_RATIO - 0.01,
    });
    expect(impaired).toEqual({ feeAnchor: 0, reason: "impaired" });
    // Exactly at the threshold the fund is still paying: the suspension is a
    // floor, not a band.
    expect(
      feeDecision({ ...base, backingRatio: FEE_SUSPENDED_BELOW_BACKING_RATIO }).feeAnchor
    ).toBeGreaterThan(0);
  });

  it("stops paying the sponsor the moment a wind-up starts", () => {
    expect(feeDecision({ ...base, status: "winding_down" })).toEqual({
      feeAnchor: 0,
      reason: "winding_down",
    });
    // A paused fund likewise earns its sponsor nothing.
    expect(feeDecision({ ...base, status: "paused" }).feeAnchor).toBe(0);
  });

  it("never forces a holding sale to pay the sponsor", () => {
    const broke = feeDecision({ ...base, cashAnchor: 1 });
    expect(broke).toEqual({ feeAnchor: 0, reason: "no_cash" });
  });

  it("charges nothing on a fund with no assets", () => {
    expect(feeDecision({ ...base, aumAnchor: 0 }).feeAnchor).toBe(0);
  });
});
