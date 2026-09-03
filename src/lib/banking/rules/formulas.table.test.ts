/**
 * Numerical lock on the balance-sheet and lending formulas.
 *
 * Every expected value below was produced by the implementation as it stood
 * BEFORE the formulas were consolidated into the rules zone. The consolidation
 * is a move, not a retune: if a number here changes, either a formula changed
 * by accident or a deliberate tuning change is being smuggled into a refactor.
 * Either way it needs its own review.
 */

import { describe, expect, it } from "vitest";
import { bankBalanceSheet, equityCappedDepositCeiling } from "./balanceSheet";
import {
  computeInsurancePremium,
  computeReserveRatioActual,
  sumInsuredPlayerDeposits,
} from "./insurance";
import { getLendableHeadroom } from "./reserves";
import {
  applyLoanPayment,
  computeNpcLoanBook,
  namedLoanHeadroom,
  namedLoanInstalment,
  npcFlowDelta,
  perTurnInterest,
} from "./loans";
import { computeNpcDepositShare } from "./deposits";
import { effectiveBankRatesFromPrime } from "./rates";
import { computeDepositCeiling } from "./capacity";
import { computeConfidence } from "./confidence";
import { assessCapital } from "./capitalAdequacy";
import { discountWindowStigma, quoteDiscountWindow } from "./discountWindow";
import { depositFlight, depositTakerFails, propBankFails } from "./solvency";

const HEALTHY = {
  type: "retail",
  status: "active",
  currency: "USD",
  cashReserves: 2_000_000,
  npcDeposits: 8_000_000,
  totalDeposits: 9_000_000,
  totalLoans: 6_500_000,
  interbankDebt: 0,
  cbMarginDebt: 0,
  discountWindowDebt: 200_000,
  discountWindowArrears: 1_000,
  cbMarginArrears: 0,
  propBookMarkValue: 0,
  depositOffset: 0.5,
  lendingOffset: 2,
} as const;

const THIN = {
  type: "retail",
  status: "active",
  currency: "USD",
  cashReserves: 300_000,
  npcDeposits: 5_000_000,
  totalDeposits: 5_000_000,
  totalLoans: 4_400_000,
  interbankDebt: 100_000,
  cbMarginDebt: 0,
  propBookMarkValue: 0,
  depositOffset: -0.25,
  lendingOffset: 1,
  capitalStanding: "stressed",
} as const;

const INVESTMENT = {
  type: "investment",
  status: "active",
  currency: "USD",
  cashReserves: 900_000,
  npcDeposits: 0,
  totalDeposits: 0,
  totalLoans: 400_000,
  interbankDebt: 250_000,
  cbMarginDebt: 150_000,
  cbMarginArrears: 5_000,
  propBookMarkValue: 700_000,
  depositOffset: 0,
  lendingOffset: 0,
} as const;

describe("balance sheet lines", () => {
  it.each([
    [
      "healthy retail, capacity 50M, ratio 0.1",
      HEALTHY,
      0.1,
      50_000_000,
      {
        pointerDeposits: 1_000_000,
        totalBorrowings: 201_000,
        bookEquity: 299_000,
        regulatoryCapital: 1_799_000,
        requiredReserves: 800_000,
        reserveSurplus: 1_200_000,
        distributable: 299_000,
        equityCeiling: 3_588_000,
        depositCeiling: 3_588_000,
        depositCeilingBinds: "equity",
        runLine: 400_000,
        reserveCoverRatio: 2.5,
        headroomToRunLine: 1_600_000,
      },
    ],
    [
      "healthy retail, no capacity input, ratio 0.2",
      HEALTHY,
      0.2,
      undefined,
      {
        requiredReserves: 1_600_000,
        reserveSurplus: 400_000,
        distributable: 299_000,
        capacityCeiling: 0,
        depositCeiling: 3_588_000,
        depositCeilingBinds: "capacity",
        runLine: 800_000,
        reserveCoverRatio: 1.25,
        headroomToRunLine: 1_200_000,
      },
    ],
    [
      "thin retail under stress, ratio 0.1",
      THIN,
      0.1,
      50_000_000,
      {
        bookEquity: -400_000,
        regulatoryCapital: 200_000,
        requiredReserves: 500_000,
        reserveSurplus: -200_000,
        distributable: 0,
        equityCeiling: 0,
        depositCeiling: 0,
        runLine: 250_000,
        reserveCoverRatio: 0.6,
        headroomToRunLine: 50_000,
      },
    ],
    [
      "thin retail, ratio 0.2",
      THIN,
      0.2,
      undefined,
      { requiredReserves: 1_000_000, reserveSurplus: -700_000, headroomToRunLine: -200_000 },
    ],
    [
      "investment, ratio 0.1",
      INVESTMENT,
      0.1,
      50_000_000,
      {
        totalBorrowings: 405_000,
        bookEquity: 895_000,
        regulatoryCapital: 495_000,
        requiredReserves: 0,
        distributable: 895_000,
        equityCeiling: 10_740_000,
        runLine: 0,
        reserveCoverRatio: 1,
        headroomToRunLine: 900_000,
      },
    ],
  ] as const)("%s", (_label, charter, reserveRatio, capacityCeiling, expected) => {
    const sheet = bankBalanceSheet({ charter: charter as never, reserveRatio, capacityCeiling });
    expect(sheet).toMatchObject(expected);
  });

  it.each([
    [50_000_000, 1_000_000, 12_000_000],
    [5_000_000, 1_000_000, 5_000_000],
    [5_000_000, -3, 0],
  ])("equityCappedDepositCeiling(%d, %d) = %d", (capacity, equity, expected) => {
    expect(equityCappedDepositCeiling(capacity, equity)).toBe(expected);
  });
});

describe("reserves and headroom", () => {
  it.each([
    ["healthy", HEALTHY, 700_000],
    ["thin", THIN, 100_000],
    ["investment", INVESTMENT, 0],
  ] as const)("getLendableHeadroom(%s, 0.1)", (_label, charter, expected) => {
    expect(getLendableHeadroom(charter as never, 0.1)).toBe(expected);
  });

  it("sizes named-loan headroom from deposits for a deposit taker and from cash otherwise", () => {
    expect(namedLoanHeadroom(HEALTHY as never, 0.1)).toBe(700_000);
    expect(namedLoanHeadroom(INVESTMENT as never, 0.1)).toBe(500_000);
  });
});

describe("insurance", () => {
  it.each([
    [9_000_000, 0.25, 0.1, 375],
    [9_000_000, 0.02, 0.1, 1_350],
    [9_000_000, 1, 0.1, 375],
    [0, 0.5, 0.1, 0],
  ])("computeInsurancePremium(%d, %d, %d) = %d", (deposits, actual, required, expected) => {
    expect(computeInsurancePremium(deposits, actual, required)).toBeCloseTo(expected, 9);
  });

  it("actual reserve ratio and insured sum", () => {
    expect(computeReserveRatioActual(300_000, 5_000_000)).toBeCloseTo(0.06, 12);
    expect(computeReserveRatioActual(10, 0)).toBe(1);
    expect(sumInsuredPlayerDeposits([1_000_000, 8_000_000, 0, -5, 5_000_000], 5_000_000)).toBe(
      11_000_000
    );
  });
});

describe("household book, deposit share, rates, capacity", () => {
  it.each([
    [7_200_000, 4, 7_200_000, 1],
    [7_200_000, 9, 4_320_000, 2.5],
    [7_200_000, 30, 1_440_000, 12],
    [0, 4, 0, 1],
  ])("computeNpcLoanBook(%d, %d)", (funding, rate, volume, defaults) => {
    const book = computeNpcLoanBook(funding, rate);
    expect(book.volume).toBeCloseTo(volume, 6);
    expect(book.expectedDefaultRatePercent).toBeCloseTo(defaults, 9);
  });

  it("applyLoanPayment", () => {
    expect(applyLoanPayment({ outstanding: 1000, status: "arrears" }, 100)).toEqual({
      outstanding: 900,
      status: "current",
    });
    expect(applyLoanPayment({ outstanding: 100, status: "current" }, 100)).toEqual({
      outstanding: 0,
      status: "repaid",
    });
    expect(applyLoanPayment({ outstanding: 100, status: "current" }, -5)).toEqual({
      outstanding: 100,
      status: "current",
    });
  });

  it("computeNpcDepositShare scales the pool down to the total cap", () => {
    const shares = computeNpcDepositShare(
      [
        { bankId: "a", effectiveDepositRatePercent: 4.5 },
        { bankId: "b", effectiveDepositRatePercent: 2 },
        { bankId: "c", effectiveDepositRatePercent: 8 },
        { bankId: "d", effectiveDepositRatePercent: 8 },
        { bankId: "e", effectiveDepositRatePercent: 8 },
      ],
      2
    );
    expect(shares.map((s) => s.share)).toEqual([
      expect.closeTo(0.10693069306930693, 12),
      expect.closeTo(0.047524752475247525, 12),
      expect.closeTo(0.1485148514851485, 12),
      expect.closeTo(0.1485148514851485, 12),
      expect.closeTo(0.1485148514851485, 12),
    ]);
  });

  it("effectiveBankRatesFromPrime floors at the module minimums", () => {
    expect(effectiveBankRatesFromPrime(HEALTHY, 4)).toEqual({
      depositRatePercent: 4.5,
      lendingRatePercent: 6,
    });
    expect(effectiveBankRatesFromPrime(THIN, 0.1)).toEqual({
      depositRatePercent: 0.05,
      lendingRatePercent: 1.1,
    });
    expect(effectiveBankRatesFromPrime(THIN, undefined)).toEqual({
      depositRatePercent: 0.05,
      lendingRatePercent: 1,
    });
  });

  it.each([
    [250, 0.5, 150_000_000],
    [10, 0.9, 10_800_000],
    [-1, 0.5, 0],
  ])("computeDepositCeiling(%d, %d) = %d", (capacity, share, expected) => {
    expect(computeDepositCeiling(capacity, share)).toBeCloseTo(expected, 6);
  });
});

describe("turn arithmetic that used to live inline", () => {
  it("perTurnInterest matches balance x rate / 48, rounded to the minor unit", () => {
    expect(perTurnInterest(48_000, 4, "USD")).toBe(40);
    expect(perTurnInterest(1_000, 4, "JPY")).toBe(1);
    expect(perTurnInterest(0, 4, "USD")).toBe(0);
    expect(perTurnInterest(1_000, 0, "USD")).toBe(0);
  });

  it("npcFlowDelta caps both directions at 2.5% of the larger stock", () => {
    expect(npcFlowDelta(0, 1_000_000)).toBe(25_000);
    expect(npcFlowDelta(1_000_000, 0)).toBe(-25_000);
    expect(npcFlowDelta(1_000_000, 1_010_000)).toBe(10_000);
    expect(npcFlowDelta(1_000_000, 990_000)).toBe(-10_000);
  });

  it("namedLoanInstalment is simple interest plus straight-line principal", () => {
    const instalment = namedLoanInstalment(
      { outstanding: 4_800, ratePercent: 4.8, originatedTurn: 100, termTurns: 48 },
      100
    );
    expect(instalment.remainingTurns).toBe(48);
    expect(instalment.interestDue).toBeCloseTo(4.8, 9);
    expect(instalment.principalDue).toBeCloseTo(100, 9);
    expect(instalment.paymentDue).toBeCloseTo(104.8, 9);
    expect(
      namedLoanInstalment(
        { outstanding: 100, ratePercent: 5, originatedTurn: 1, termTurns: 10 },
        50
      ).remainingTurns
    ).toBe(1);
  });
});

describe("confidence, capital, window, solvency", () => {
  it("computeConfidence", () => {
    expect(
      computeConfidence({
        cashReserves: 2_000_000,
        postedCapital: 1_000_000,
        cashBackedDeposits: 8_000_000,
        totalLoans: 6_500_000,
        reserveRatioRequired: 0.1,
        arrearsOutstanding: 100_000,
        defaultsLastTurn: 0,
        panicTurns: 0,
        forcedLiquidation: false,
        discountWindowStigma: 0.02,
      })
    ).toEqual({ confidence: expect.closeTo(0.8036923076923077, 12), band: "green" });
    expect(
      computeConfidence({
        cashReserves: 100_000,
        postedCapital: 50_000,
        cashBackedDeposits: 5_000_000,
        totalLoans: 4_400_000,
        reserveRatioRequired: 0.1,
        arrearsOutstanding: 900_000,
        defaultsLastTurn: 200_000,
        panicTurns: 3,
        forcedLiquidation: true,
        discountWindowStigma: 0.1,
      })
    ).toEqual({ confidence: 0, band: "red" });
  });

  it("assessCapital", () => {
    expect(
      assessCapital({
        cashReserves: 2_000_000,
        totalLoans: 6_500_000,
        borrowings: { discountWindowDebt: 200_000, discountWindowArrears: 1_000 },
        propBookMarkValue: 0,
        bookTranches: [
          { creditBand: "prime", outstanding: 3_000_000 },
          { creditBand: "subprime", outstanding: 3_500_000 },
        ],
      })
    ).toEqual({
      capitalAnchor: 1_799_000,
      riskAssetsAnchor: 6_500_000,
      capitalRatio: expect.closeTo(0.27676923076923077, 12),
      stressedCapitalRatio: expect.closeTo(0.23870445344129554, 12),
      appliedStressLossFraction: 0.05,
      standing: "adequate",
    });
  });

  it("discount window quote and stigma", () => {
    expect(quoteDiscountWindow({ npcDeposits: 8_000_000, discountWindowDebt: 200_000 }, 4)).toEqual(
      { capAnchor: 2_000_000, headroomAnchor: 1_800_000, ratePercent: 7 }
    );
    expect(
      discountWindowStigma({ npcDeposits: 8_000_000, discountWindowDebt: 200_000 })
    ).toBeCloseTo(0.01, 12);
    expect(discountWindowStigma({ npcDeposits: 0, discountWindowDebt: 5 })).toBe(0.1);
  });

  it("solvency tests match the turn's inline rules", () => {
    expect(
      depositTakerFails({ priorBand: "red", cashReserves: 199_999, requiredLiquidity: 400_000 })
    ).toBe(true);
    expect(
      depositTakerFails({ priorBand: "red", cashReserves: 200_000, requiredLiquidity: 400_000 })
    ).toBe(false);
    expect(
      depositTakerFails({ priorBand: "amber", cashReserves: 0, requiredLiquidity: 400_000 })
    ).toBe(false);
    expect(propBankFails({ band: "red", equityBase: 0 })).toBe(true);
    expect(propBankFails({ band: "red", equityBase: 1 })).toBe(false);
    expect(propBankFails({ band: "amber", equityBase: -5 })).toBe(false);
    expect(depositFlight({ priorBand: "amber", npcDeposits: 1_000_000, cashReserves: 5_000 })).toBe(
      5_000
    );
    expect(depositFlight({ priorBand: "red", npcDeposits: 1_000_000, cashReserves: 900_000 })).toBe(
      300_000
    );
    expect(
      depositFlight({ priorBand: "green", npcDeposits: 1_000_000, cashReserves: 900_000 })
    ).toBe(0);
  });
});
