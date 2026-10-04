import { describe, expect, it } from "vitest";
import { quotePrimaryUnderwritingFee, primaryUnderwritingCharterEligible } from "./underwriting";

describe("primary underwriting rules", () => {
  it("charges a modest fee only on placed gross proceeds", () => {
    expect(quotePrimaryUnderwritingFee({ grossPlacedLocal: 125_000, feeRate: 0.015 })).toEqual({
      grossPlacedLocal: 125_000,
      feeLocal: 1_875,
      issuerNetLocal: 123_125,
    });
    expect(quotePrimaryUnderwritingFee({ grossPlacedLocal: 0, feeRate: 0.015 })).toEqual({
      grossPlacedLocal: 0,
      feeLocal: 0,
      issuerNetLocal: 0,
    });
  });

  it("fails closed for inactive, wrong-currency, or non-investment charters", () => {
    const base = {
      status: "active",
      type: "investment",
      currency: "USD",
      charteredTurn: 12,
    } as const;
    expect(primaryUnderwritingCharterEligible(base, "USD")).toBe(true);
    expect(primaryUnderwritingCharterEligible({ ...base, type: "retail" }, "USD")).toBe(false);
    expect(primaryUnderwritingCharterEligible({ ...base, status: "failed" }, "USD")).toBe(false);
    expect(primaryUnderwritingCharterEligible(base, "GBP")).toBe(false);
  });

  it("rejects invalid rates and proceeds rather than creating negative or free fills", () => {
    expect(() => quotePrimaryUnderwritingFee({ grossPlacedLocal: 100, feeRate: -0.01 })).toThrow();
    expect(() =>
      quotePrimaryUnderwritingFee({ grossPlacedLocal: Infinity, feeRate: 0.01 })
    ).toThrow();
  });
});
