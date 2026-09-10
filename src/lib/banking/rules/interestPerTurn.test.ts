import { describe, expect, it } from "vitest";
import { estimateInterestPerTurn } from "./loans";

// Ticket 1267 followup (issue 1748): the bank console showed annual rates
// but no per-turn money figures, so owners could not see interest paid vs
// earned. These lock the estimate the console now displays.

describe("estimateInterestPerTurn", () => {
  it("nets performing-loan income against deposit cost", () => {
    // 48 turns/year: 4.8M at 10% costs 10k/turn; 2.4M at 10% earns 5k/turn.
    const result = estimateInterestPerTurn({
      totalDeposits: 4_800_000,
      depositRatePercent: 10,
      loans: [{ outstanding: 2_400_000, ratePercent: 10, status: "current" }],
    });
    expect(result.depositCostPerTurn).toBe(10_000);
    expect(result.loanIncomePerTurn).toBe(5_000);
    expect(result.netPerTurn).toBe(-5_000);
  });

  it("ignores non-performing lines and counts interbank lending", () => {
    const result = estimateInterestPerTurn({
      totalDeposits: 0,
      depositRatePercent: 5,
      loans: [
        { outstanding: 4_800_000, ratePercent: 10, status: "defaulted" },
        { outstanding: 4_800_000, ratePercent: 10, status: "arrears" },
      ],
      interbankLending: [{ outstanding: 4_800_000, ratePercent: 10, status: "current" }],
    });
    // Defaulted line earns nothing; arrears still accrues; lender leg counts.
    expect(result.loanIncomePerTurn).toBe(20_000);
    expect(result.depositCostPerTurn).toBe(0);
  });

  it("returns zeros for an empty book", () => {
    expect(
      estimateInterestPerTurn({ totalDeposits: 0, depositRatePercent: null, loans: [] })
    ).toEqual({ depositCostPerTurn: 0, loanIncomePerTurn: 0, netPerTurn: 0 });
  });
});
