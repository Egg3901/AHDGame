import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  NAMED_LOAN_DTI_MAX_FRACTION,
  bindingNamedLoanCap,
  convertFaceBetweenCurrencies,
  maxPrincipalFromIncome,
  namedLoanPaymentDue,
  namedLoanPrincipalCap,
  remainingLoanTurns,
} from "./lendingMath";

describe("namedLoanPaymentDue", () => {
  it("is straight-line principal plus annual interest / turns-per-year", () => {
    // $48,000 over 12 remaining turns at 48% → $4,000 principal + $480 interest.
    expect(namedLoanPaymentDue(48_000, 48, 12)).toBe(4_000 + (48_000 * 0.48) / TURNS_PER_YEAR);
    expect(namedLoanPaymentDue(48_000, 48, 12)).toBe(4_480);
  });

  it("treats non-positive remaining turns as 1", () => {
    expect(namedLoanPaymentDue(1_000, 0, 0)).toBe(1_000);
  });
});

describe("remainingLoanTurns", () => {
  it("counts originatedTurn + termTurns - currentTurn, floored at 1", () => {
    expect(remainingLoanTurns(100, 12, 100)).toBe(12);
    expect(remainingLoanTurns(100, 12, 111)).toBe(1);
    expect(remainingLoanTurns(100, 12, 200)).toBe(1);
  });
});

describe("maxPrincipalFromIncome", () => {
  it("at zero interest is leftover DTI budget times term", () => {
    // 10_000 income × 0.35 DTI = 3_500 / turn × 10 turns = 35_000
    expect(
      maxPrincipalFromIncome({
        incomePerTurn: 10_000,
        ratePercent: 0,
        termTurns: 10,
      })
    ).toBe(35_000);
  });

  it("subtracts already-committed named-loan payments from the DTI budget", () => {
    expect(
      maxPrincipalFromIncome({
        incomePerTurn: 10_000,
        ratePercent: 0,
        termTurns: 10,
        committedPaymentPerTurn: 1_500,
      })
    ).toBe(20_000);
  });

  it("returns 0 when income cannot cover existing payments", () => {
    expect(
      maxPrincipalFromIncome({
        incomePerTurn: 1_000,
        ratePercent: 0,
        termTurns: 12,
        committedPaymentPerTurn: 400,
      })
    ).toBe(0);
  });

  it("is stricter than a 70% DTI at the same income", () => {
    const args = { incomePerTurn: 10_000, ratePercent: 0, termTurns: 10 };
    const strict = maxPrincipalFromIncome(args);
    const locLike = maxPrincipalFromIncome({ ...args, dtiFraction: 0.7 });
    expect(strict).toBe(35_000);
    expect(locLike).toBe(70_000);
    expect(NAMED_LOAN_DTI_MAX_FRACTION).toBe(0.35);
  });
});

describe("namedLoanPrincipalCap", () => {
  it("is the min of bank cash, deposit headroom, and income cap", () => {
    expect(
      namedLoanPrincipalCap({
        bankCashReserves: 100,
        lendableHeadroom: 50,
        incomeCap: 80,
      })
    ).toBe(50);
    expect(
      bindingNamedLoanCap({
        bankCashReserves: 100,
        lendableHeadroom: 50,
        incomeCap: 80,
      })
    ).toBe("headroom");
    expect(
      bindingNamedLoanCap({
        bankCashReserves: 10,
        lendableHeadroom: 50,
        incomeCap: 80,
      })
    ).toBe("cashReserves");
    expect(
      bindingNamedLoanCap({
        bankCashReserves: 100,
        lendableHeadroom: 50,
        incomeCap: 5,
      })
    ).toBe("income");
  });
});

describe("convertFaceBetweenCurrencies", () => {
  it("is identity when the codes match, even with dummy rates", () => {
    expect(convertFaceBetweenCurrencies(1_000, "USD", "USD", 0, 0)).toBe(1_000);
  });

  it("converts through the anchor (local per 1 ₳)", () => {
    // $100 at 1.0 USD/₳ → £80 at 0.8 GBP/₳
    expect(convertFaceBetweenCurrencies(100, "USD", "GBP", 1, 0.8)).toBe(80);
  });
});
