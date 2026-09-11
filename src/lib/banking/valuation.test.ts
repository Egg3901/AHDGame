import { describe, expect, it } from "vitest";
import { BANK_EQUITY_VALUATION_WEIGHT } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { bankNpvFromPerTurnIncome, bankValuation } from "./valuation";

describe("bank valuation", () => {
  it("haircuts the bank's residual equity at the market valuation weight", () => {
    const charter = {
      cashReserves: 10_000,
      totalLoans: 4_000,
      npcDeposits: 6_000,
      totalDeposits: 6_000,
      discountWindowDebt: 0,
      cbMarginDebt: 0,
      interbankDebt: 0,
    } as never;

    expect(bankValuation(charter)).toBe(BANK_EQUITY_VALUATION_WEIGHT * (10_000 + 4_000 - 6_000));
  });

  it("annualizes positive realized income and floors losses at zero", () => {
    expect(bankNpvFromPerTurnIncome(100)).toBe(Math.round((100 * TURNS_PER_YEAR) / 0.15));
    expect(bankNpvFromPerTurnIncome(-100)).toBe(0);
  });
});
