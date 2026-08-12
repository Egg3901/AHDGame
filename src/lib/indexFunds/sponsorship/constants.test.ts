import { describe, it, expect } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  MAX_EXPENSE_RATIO_ANNUAL,
  MIN_EXPENSE_RATIO_ANNUAL,
  expenseFeeForTurn,
  expenseRatioBasisPoints,
} from "./constants";

describe("expenseFeeForTurn", () => {
  it("spreads the annual ratio evenly across the game year", () => {
    const aum = 100_000_000;
    const ratio = 0.01;
    const perTurn = expenseFeeForTurn(aum, ratio);
    expect(perTurn * TURNS_PER_YEAR).toBeCloseTo(aum * ratio, 6);
  });

  it("caps at the ceiling, so a bad write cannot drain a fund", () => {
    const aum = 100_000_000;
    const absurd = expenseFeeForTurn(aum, 5);
    const capped = expenseFeeForTurn(aum, MAX_EXPENSE_RATIO_ANNUAL);
    expect(absurd).toBe(capped);
  });

  it("charges nothing on an empty or malformed fund", () => {
    expect(expenseFeeForTurn(0, 0.01)).toBe(0);
    expect(expenseFeeForTurn(-5, 0.01)).toBe(0);
    expect(expenseFeeForTurn(Number.NaN, 0.01)).toBe(0);
    expect(expenseFeeForTurn(1_000, 0)).toBe(0);
    expect(expenseFeeForTurn(1_000, Number.NaN)).toBe(0);
  });

  it("keeps the ceiling low enough that a year of fees is a fraction of AUM", () => {
    // A sanity bound on the balance, not a restatement of the constant: at the
    // worst permitted ratio a holder still keeps ~98% of their capital a year.
    const aum = 1_000_000;
    const annual = expenseFeeForTurn(aum, MAX_EXPENSE_RATIO_ANNUAL) * TURNS_PER_YEAR;
    expect(annual / aum).toBeLessThanOrEqual(0.02);
    expect(MIN_EXPENSE_RATIO_ANNUAL).toBeLessThan(MAX_EXPENSE_RATIO_ANNUAL);
  });
});

describe("expenseRatioBasisPoints", () => {
  it("converts for display without floating-point noise", () => {
    expect(expenseRatioBasisPoints(0.0075)).toBe(75);
    expect(expenseRatioBasisPoints(0.02)).toBe(200);
    expect(expenseRatioBasisPoints(0.001)).toBe(10);
  });
});
