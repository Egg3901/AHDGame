import { describe, expect, it } from "vitest";
import { openingNationalTreasurySnapshots } from "./treasurySnapshot";
import { settleResetCashTurn } from "./cashTurn";
import { settleLiveDepartmentTurn } from "./liveDepartmentTurn";
import type { ResetDepartmentAccountSnapshot } from "./liveDepartmentAccount";

const opening = openingNationalTreasurySnapshots("world", 1, {
  US: { debt: 100, debtCeiling: 110 },
  UK: { debt: 1, debtCeiling: 2 },
  JP: { debt: 1, debtCeiling: 2 },
})[0]!;
const flows = {
  revenue: 8,
  annualInterestRate: 0,
  periodsPerYear: 48,
  bondProceeds: 0,
  bondFaceIssued: 0,
  bondMaturityCashPaid: 0,
  bondFaceRetired: 0,
  bondCouponCashPaid: 0,
};
const claims = [{ id: "department", category: "existing" as const, amount: 10 }];

describe("v2 cash authority", () => {
  it("pays enacted authority in full and records the operating deficit financing", () => {
    const first = settleResetCashTurn({ treasury: opening, turn: 2, claims, flows });
    expect(first.lastPaidByClaim).toEqual({ department: 10 });
    expect(first.claimArrears).toEqual({ department: 0 });
    expect(first.lastAppropriationFinancing).toBe(2);
    const next = settleResetCashTurn({
      treasury: first,
      turn: 3,
      claims,
      flows: { ...flows, revenue: 12 },
    });
    expect(next.lastPaidByClaim).toEqual({ department: 10 });
    expect(next.arrears.existing).toBe(0);
    expect(next.lastAppropriationFinancing).toBe(0);
    expect(next.cash).toBe(2);
  });
  it("catches up authority left unpaid by the former cash gate", () => {
    const next = settleResetCashTurn({
      treasury: {
        ...opening,
        arrears: { ...opening.arrears, existing: 2 },
        claimArrears: { department: 2 },
      },
      turn: 2,
      claims,
      flows: { ...flows, revenue: 0 },
    });
    expect(next.lastPaidByClaim).toEqual({ department: 12 });
    expect(next.claimArrears).toEqual({ department: 0 });
    expect(next.arrears.existing).toBe(0);
    expect(next.lastAppropriationFinancing).toBe(12);
  });
  it("records a bond emergency without withholding enacted Cabinet authority", () => {
    const next = settleResetCashTurn({
      treasury: opening,
      turn: 2,
      claims,
      flows: { ...flows, bondCouponCashPaid: 11 },
    });
    expect(next.emergencyAdvance).toBe(3);
    expect(next.lastPaidByClaim).toEqual({ department: 10 });
    expect(next.lastAppropriationFinancing).toBe(10);
    expect(next.fiscalCrisis).toEqual({ sinceTurn: 2, reason: "emergency_advance" });
  });
  it("conserves fractional cash without fractional authority credits", () => {
    const next = settleResetCashTurn({
      treasury: opening,
      turn: 2,
      claims,
      flows: { ...flows, revenue: 8.75 },
    });
    expect(next.cash).toBe(0);
    expect(next.lastAppropriationFinancing).toBe(1.25);
    expect(next.claimArrears).toEqual({ department: 0 });
    expect(next.arrears.existing).toBe(0);
  });
  it("rejects discarded claims, inconsistent category debt, and skipped turns", () => {
    const first = settleResetCashTurn({ treasury: opening, turn: 2, claims, flows });
    expect(() =>
      settleResetCashTurn({
        treasury: { ...first, claimArrears: { department: 1 } },
        turn: 3,
        claims: [],
        flows,
      })
    ).toThrow("discard");
    expect(() =>
      settleResetCashTurn({
        treasury: { ...opening, arrears: { ...opening.arrears, existing: 1 } },
        turn: 2,
        claims,
        flows,
      })
    ).toThrow("reconcile");
    expect(() => settleResetCashTurn({ treasury: opening, turn: 3, claims, flows })).toThrow(
      "one turn"
    );
  });
  it("allows a department to receive arrears but not invented extra authority", () => {
    const account = {
      _id: "US:health",
      worldId: "world",
      countryId: "US",
      departmentId: "health",
      sourceTurn: 1,
      accruedThroughTurn: 1,
      lastAuthorityPaid: 0,
      unpaidAuthority: 2,
      annualAuthority: 480,
      controllingSeatId: "secretary_of_health",
      openingAgencyNames: ["Health"],
      grossAnnualClaim: 480,
      grantReservation: 0,
      familyGrossAnnualDemand: { L18: 480 },
      familyGrantReservation: {},
      balance: 0,
      encumbered: 0,
      arrears: 0,
      externallySettled: false,
      familyAnnualDemand: { L18: 480 },
      programAllocationPercents: {},
      lastProgramDelivery: {},
    } as ResetDepartmentAccountSnapshot;
    const result = settleLiveDepartmentTurn({ account, turn: 2, authorityPaid: 12 });
    expect(result.next.unpaidAuthority).toBe(0);
    expect(result.next.balance).toBe(2);
    expect(
      settleLiveDepartmentTurn({ account: result.next, turn: 2, authorityPaid: 12 }).settlement
        ?.replayed
    ).toBe(true);
    expect(() => settleLiveDepartmentTurn({ account, turn: 2, authorityPaid: 13 })).toThrow(
      "schedule"
    );
  });
});
