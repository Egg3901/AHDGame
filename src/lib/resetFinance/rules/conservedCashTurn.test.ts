import { describe, expect, it } from "vitest";
import { settleConservedResetCashTurn } from "./conservedCashTurn";
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
  it("pays every claim from funded cash and ignores the synthetic book cash", () => {
    const next = settleConservedResetCashTurn({
      treasury: treasury(1_000_000),
      turn: 5,
      claims,
      fundedCash: 200.7,
    });
    expect(next.lastPaidByClaim).toEqual({ "UK:health": 60, "UK:defence": 50 });
    expect(next.conservedFunding).toEqual({ turn: 5, fundedCash: 200.7, paidTotal: 110 });
    expect(next.cash).toBe(1_000_000);
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
});
