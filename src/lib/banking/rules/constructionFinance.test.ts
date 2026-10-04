import { describe, expect, it } from "vitest";
import { BANKING_POLICY_ALL_ON } from "./policy";
import { legsNet } from "./invariants";
import {
  allocateConstructionCancellation,
  quoteConstructionFinance,
  type ConstructionFinanceQuoteInput,
} from "./constructionFinance";

function input(): ConstructionFinanceQuoteInput {
  return {
    enabled: true,
    bank: {
      turn: 10,
      policy: BANKING_POLICY_ALL_ON,
      bankId: "a".repeat(24),
      currency: "USD",
      charter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 2_000_000,
        npcDeposits: 1_000_000,
        totalDeposits: 1_000_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 2,
      },
      corporationLiquidCapital: 0,
      reserveRatio: 0.2,
      playerDepositsAreLiabilities: false,
      primeRate: 3,
      centralBankId: "US",
    },
    borrower: {
      type: "corporation",
      id: "b".repeat(24),
      incomePerTurn: 10_000,
      committedPaymentPerTurn: 0,
      blocked: false,
      currencyMatches: true,
    },
    loanId: "c".repeat(24),
    claimId: "build-request-1",
    sectorId: "d".repeat(24),
    constructionCostLocal: 100_000,
    collateralCostLocal: 100_000,
    borrowerCashLocal: 50_000,
    principal: 75_000,
    termTurns: 48,
  };
}

describe("construction finance underwriting", () => {
  it.each([NaN, Infinity, -0.1, 1.1])(
    "refuses an invalid reserve ratio %s before quoting cash",
    (reserveRatio) => {
      const request = input();
      request.bank.reserveRatio = reserveRatio;
      expect(quoteConstructionFinance(request)).toMatchObject({ allowed: false });
    }
  );

  it("funds only construction escrow and requires own cash including the withheld fee", () => {
    const result = quoteConstructionFinance(input());
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error(result.error);
    expect(result).toMatchObject({
      pending: false,
      proceeds: 74_250,
      originationFee: 750,
      borrowerContribution: 25_750,
      collateralLimit: 75_000,
    });
    expect(legsNet(result.transition.legs)).toBe(0);
    expect(
      result.transition.legs.some((leg) => leg.kind === "credit" && leg.path === "liquidCapital")
    ).toBe(false);
    expect(result.transition.legs.find((leg) => leg.kind === "credit")).toMatchObject({
      collection: "corporateSectors",
      path: "constructionFinancing.escrowLocal",
      amount: 74_250,
      filter: { _id: { $oid: "d".repeat(24) }, "constructionFinancing.claimId": "build-request-1" },
    });
    expect(result.transition.legs.find((leg) => leg.kind === "debit")).toMatchObject({
      filter: { "bankCharter.charteredTurn": 1 },
    });
    expect(result.transition.projections.find((projection) => projection.update)).toMatchObject({
      filter: { "bankCharter.charteredTurn": 1 },
    });
    expect(result.transition.projections[0].insert).toMatchObject({
      charteredTurn: 1,
      constructionCollateral: { claimId: "build-request-1", quotedCostLocal: 100_000 },
    });
  });

  it("keeps lender approval pending without funding or construction cash", () => {
    const request = input();
    request.bank.charter!.requireApproval = true;
    const result = quoteConstructionFinance(request);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error(result.error);
    expect(result.pending).toBe(true);
    expect(result.transition.legs).toEqual([]);
    expect(result.transition.projections[0].insert).toMatchObject({ status: "pending" });
  });

  it.each([
    { enabled: false },
    { principal: 75_001 },
    { borrowerCashLocal: 25_749 },
    { collateralCostLocal: 50_000 },
    { constructionCostLocal: Number.NaN },
  ])("refuses disabled, underfunded or overpledged construction", (overrides) => {
    expect(quoteConstructionFinance({ ...input(), ...overrides }).allowed).toBe(false);
  });

  it("retains ordinary income, currency, blacklist and bank reserve refusal rules", () => {
    for (const borrower of [
      { ...input().borrower, incomePerTurn: 0 },
      { ...input().borrower, currencyMatches: false },
      { ...input().borrower, blocked: true },
    ])
      expect(quoteConstructionFinance({ ...input(), borrower }).allowed).toBe(false);
    const request = input();
    request.bank.charter!.cashReserves = 1;
    expect(quoteConstructionFinance(request).allowed).toBe(false);
  });
});

describe("construction cancellation allocation", () => {
  it("repays the lender before releasing any owner refund", () => {
    expect(allocateConstructionCancellation(75_000, 75_000)).toEqual({
      repayPrincipal: 75_000,
      ownerRefund: 0,
    });
    expect(allocateConstructionCancellation(75_000, 60_000)).toEqual({
      repayPrincipal: 60_000,
      ownerRefund: 15_000,
    });
    expect(allocateConstructionCancellation(10_000, 75_000)).toEqual({
      repayPrincipal: 10_000,
      ownerRefund: 0,
    });
  });
});
