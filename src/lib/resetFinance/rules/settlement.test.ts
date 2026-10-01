import { describe, expect, it } from "vitest";
import {
  reconcileGrantTransfer,
  settleNationalTreasury,
  settleRegionalTreasury,
  type NationalTreasuryState,
} from "./settlement";

const opening: NationalTreasuryState = {
  cash: 10,
  debt: 100,
  debtCeiling: 105,
  emergencyAdvance: 0,
  arrears: { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 },
};

describe("reset treasury settlement", () => {
  it("pays priority claims, records unpaid obligations, and does not cap issuance silently", () => {
    const result = settleNationalTreasury(opening, {
      revenue: 20,
      bondProceeds: 10,
      bondFaceIssued: 10,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0.12,
      periodsPerYear: 12,
      operatingClaims: { mandatory: 15, grants: 10, existing: 20, new: 5 },
    });
    expect(result.due.interest).toBe(1);
    expect(result.paid).toEqual({ interest: 1, mandatory: 15, grants: 10, existing: 14, new: 0 });
    expect(result.closing.arrears).toEqual({
      interest: 0,
      mandatory: 0,
      grants: 0,
      existing: 6,
      new: 5,
    });
    expect(result.ceilingExceeded).toBe(true);
    expect(result.externalOutlay).toBe(30);
    expect(result.grantTransfer).toBe(10);
    expect(result.accountingResidual).toBe(0);
  });

  it("carries unpaid claims into the next turn ahead of new initiatives", () => {
    const first = settleNationalTreasury(opening, {
      revenue: 0,
      bondProceeds: 0,
      bondFaceIssued: 0,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 20, grants: 0, existing: 0, new: 0 },
    });
    const second = settleNationalTreasury(first.closing, {
      revenue: 30,
      bondProceeds: 0,
      bondFaceIssued: 0,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 0, existing: 0, new: 25 },
    });
    expect(first.closing.arrears.mandatory).toBe(10);
    expect(second.paid.mandatory).toBe(10);
    expect(second.paid.new).toBe(20);
    expect(second.closing.arrears.new).toBe(5);
  });

  it("credits actual placement cash but adds only bond face to debt", () => {
    const result = settleNationalTreasury(opening, {
      revenue: 0,
      bondProceeds: 9,
      bondFaceIssued: 10,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 0, existing: 0, new: 0 },
    });
    expect(result.closing.cash).toBe(19);
    expect(result.closing.debt).toBe(110);
    expect(result.accountingResidual).toBe(0);
  });

  it("retires matured bond face without pretending repayment is new revenue", () => {
    const result = settleNationalTreasury(opening, {
      revenue: 0,
      bondProceeds: 12,
      bondFaceIssued: 12,
      bondMaturityCashPaid: 20,
      bondFaceRetired: 12,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 0, existing: 0, new: 0 },
    });
    expect(result.closing.debt).toBe(100);
    expect(result.closing.cash).toBe(2);
    expect(result.maturityOutlay).toBe(20);
    expect(result.accountingResidual).toBe(0);
    expect(() =>
      settleNationalTreasury(opening, {
        revenue: 0,
        bondProceeds: 0,
        bondFaceIssued: 0,
        bondMaturityCashPaid: 101,
        bondFaceRetired: 101,
        annualInterestRate: 0,
        periodsPerYear: 48,
        operatingClaims: { mandatory: 0, grants: 0, existing: 0, new: 0 },
      })
    ).toThrow("retirement exceeds");
  });

  it("records an emergency advance for bondholders and withholds unfunded Cabinet claims", () => {
    const result = settleNationalTreasury(opening, {
      revenue: 0,
      bondProceeds: 0,
      bondFaceIssued: 0,
      bondMaturityCashPaid: 20,
      bondFaceRetired: 10,
      bondCouponCashPaid: 15,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 0, existing: 5, new: 0 },
    });
    expect(result.emergencyAdvanceDrawn).toBe(25);
    expect(result.paid.interest).toBe(15);
    expect(result.paid.existing).toBe(0);
    expect(result.closing).toMatchObject({
      cash: 0,
      debt: 90,
      emergencyAdvance: 25,
      arrears: { existing: 5 },
    });
    expect(result.ceilingExceeded).toBe(true);
    expect(result.accountingResidual).toBe(0);
  });

  it("regional grants cancel once and shortfalls do not repeal the law", () => {
    const national = settleNationalTreasury(opening, {
      revenue: 50,
      bondProceeds: 0,
      bondFaceIssued: 0,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 12, existing: 0, new: 0 },
    });
    const first = settleRegionalTreasury(
      { cash: 0, arrears: 0 },
      { ownRevenue: 4, grantReceived: 7, protectedClaims: 8, discretionaryClaims: 6 }
    );
    const second = settleRegionalTreasury(
      { cash: 0, arrears: 0 },
      { ownRevenue: 0, grantReceived: 5, protectedClaims: 8, discretionaryClaims: 6 }
    );
    expect(reconcileGrantTransfer(national, [7, 5])).toBe(0);
    expect(first.discretionaryPaid).toBe(3);
    expect(first.closing.arrears).toBe(0);
    expect(second.discretionaryPaid).toBe(0);
    expect(second.closing.arrears).toBe(3);
    expect(first.accountingResidual).toBe(0);
    expect(second.accountingResidual).toBe(0);
  });

  it("rejects invalid fiscal data and mismatched grant credits", () => {
    expect(() =>
      settleNationalTreasury(opening, {
        revenue: Number.NaN,
        bondProceeds: 0,
        bondFaceIssued: 0,
        bondMaturityCashPaid: 0,
        bondFaceRetired: 0,
        annualInterestRate: 0,
        periodsPerYear: 48,
        operatingClaims: { mandatory: 0, grants: 0, existing: 0, new: 0 },
      })
    ).toThrow(/revenue/);
    const national = settleNationalTreasury(opening, {
      revenue: 50,
      bondProceeds: 0,
      bondFaceIssued: 0,
      bondMaturityCashPaid: 0,
      bondFaceRetired: 0,
      annualInterestRate: 0,
      periodsPerYear: 48,
      operatingClaims: { mandatory: 0, grants: 12, existing: 0, new: 0 },
    });
    expect(reconcileGrantTransfer(national, [5, 5])).toBe(2);
  });
});
