import { describe, expect, it } from "vitest";
import { markedFundBacking, sponsorSeedUnits, sponsorUnitsLocked } from "./accounting";

describe("sponsor accounting rules", () => {
  it("counts cash once and includes equity, bonds and owned escrow", () => {
    expect(
      markedFundBacking({
        cashAnchor: 25,
        stockValueAnchor: 50,
        bondValueAnchor: 20,
        orderEscrowAnchor: 5,
      })
    ).toBe(100);
    expect(() =>
      markedFundBacking({
        cashAnchor: NaN,
        stockValueAnchor: 0,
        bondValueAnchor: 0,
        orderEscrowAnchor: 0,
      })
    ).toThrow();
  });
  it("seed units match the actual cash posted, including fractional cash", () => {
    expect(sponsorSeedUnits(10_000_000.123, 100) * 100).toBeCloseTo(10_000_000.123, 8);
    expect(() => sponsorSeedUnits(0, 100)).toThrow();
    expect(() => sponsorSeedUnits(100, 0)).toThrow();
  });
  it("locks paid sponsor units while investors or withdrawals remain", () => {
    const input = {
      accounting: "paid_units" as const,
      isSponsor: true,
      otherHolders: 1,
      pendingWithdrawals: 0,
    };
    expect(sponsorUnitsLocked(input)).toBe(true);
    expect(sponsorUnitsLocked({ ...input, otherHolders: 0, pendingWithdrawals: 1 })).toBe(true);
    expect(sponsorUnitsLocked({ ...input, otherHolders: 0 })).toBe(false);
    expect(sponsorUnitsLocked({ ...input, isSponsor: false })).toBe(false);
    expect(sponsorUnitsLocked({ ...input, accounting: "legacy_residual" })).toBe(false);
    expect(sponsorUnitsLocked({ ...input, accounting: undefined })).toBe(false);
  });
});
