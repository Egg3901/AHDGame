import { describe, expect, it } from "vitest";
import { settleConservedResetCashTurn, unpaidConservedReceipt } from "./conservedCashTurn";
import type { ResetNationalTreasurySnapshot } from "./treasurySnapshot";

const treasury = (cash: number): ResetNationalTreasurySnapshot =>
  ({
    _id: "UK",
    worldId: "w",
    countryId: "UK",
    sourceTurn: 1,
    settledThroughTurn: 4,
    cash,
    debt: 1000,
    arrears: { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 },
    claimArrears: {},
  }) as unknown as ResetNationalTreasurySnapshot;

const claims = [
  { id: "UK:health", category: "mandatory" as const, amount: 60 },
  { id: "UK:defence", category: "existing" as const, amount: 50 },
];

describe("settleConservedResetCashTurn", () => {
  it("pays every claim from funded cash and replaces the synthetic book cash", () => {
    const next = settleConservedResetCashTurn({
      treasury: treasury(1_000_000),
      turn: 5,
      claims,
      fundedCash: 200.7,
      bondFaceIssued: 300,
      bondFaceRetired: 100,
    });
    expect(next.lastPaidByClaim).toEqual({ "UK:health": 60, "UK:defence": 50 });
    expect(next.conservedFunding).toEqual({
      turn: 5,
      fundedCash: 200.7,
      paidTotal: 110,
      plannedTotal: 110,
      status: "planned",
    });
    // Non-owning projection of funded cash after payment; debt is face only.
    expect(next.cash).toBeCloseTo(90.7);
    expect(next.debt).toBe(1200);
    expect(next.lastAppropriationFinancing).toBe(0);
    expect(next.lastEmergencyAdvanceDrawn).toBe(0);
  });

  it("pays in priority order and records the shortfall as per-claim arrears", () => {
    const next = settleConservedResetCashTurn({
      treasury: treasury(0),
      turn: 5,
      claims,
      fundedCash: 80,
    });
    expect(next.lastPaidByClaim).toEqual({ "UK:health": 60, "UK:defence": 20 });
    expect(next.claimArrears).toEqual({ "UK:health": 0, "UK:defence": 30 });
    expect(next.arrears.existing).toBe(30);
    expect(next.conservedFunding?.paidTotal).toBe(80);
  });

  it("carries prior arrears and never pays from a negative balance", () => {
    const opening = {
      ...treasury(0),
      arrears: { interest: 0, mandatory: 0, grants: 0, existing: 30, new: 0 },
      claimArrears: { "UK:health": 0, "UK:defence": 30 },
    };
    const dry = settleConservedResetCashTurn({
      treasury: opening,
      turn: 5,
      claims,
      fundedCash: -10,
    });
    expect(dry.conservedFunding?.paidTotal).toBe(0);
    expect(dry.claimArrears).toEqual({ "UK:health": 60, "UK:defence": 80 });
    expect(() =>
      settleConservedResetCashTurn({ treasury: opening, turn: 5, claims: [], fundedCash: 1 })
    ).toThrow("unpaid claimant");
  });

  it("returns a wholly refused plan to arrears without losing a claimant", () => {
    const planned = settleConservedResetCashTurn({
      treasury: {
        ...treasury(0),
        arrears: { interest: 0, mandatory: 0, grants: 0, existing: 30, new: 0 },
        claimArrears: { "UK:health": 0, "UK:defence": 30 },
      },
      turn: 5,
      claims,
      fundedCash: 100,
    });
    expect(planned.lastPaidByClaim).toEqual({ "UK:health": 60, "UK:defence": 40 });
    const refused = unpaidConservedReceipt(planned);
    expect(refused.lastPaidByClaim).toEqual({ "UK:health": 0, "UK:defence": 0 });
    expect(refused.claimArrears).toEqual({ "UK:health": 60, "UK:defence": 80 });
    expect(refused.arrears).toMatchObject({ mandatory: 60, existing: 80 });
    expect(refused.lastPaid).toMatchObject({ mandatory: 0, existing: 0 });
    expect(refused.conservedFunding).toMatchObject({
      paidTotal: 0,
      plannedTotal: 100,
      status: "refused",
    });
    expect(refused.cash).toBe(100);
    expect(() => unpaidConservedReceipt(refused)).toThrow("planned");
  });
});
