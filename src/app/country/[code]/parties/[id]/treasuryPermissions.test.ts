import { describe, expect, it } from "vitest";
import { resolveTreasuryPermissions } from "./treasuryPermissions";

const NO_ROLES = {
  isAdmin: false,
  isChair: false,
  isViceChair: false,
  isTreasurer: false,
  isTreasurerSeatVacant: false,
};

describe("resolveTreasuryPermissions", () => {
  it("grants nothing to a member with no treasury role", () => {
    expect(resolveTreasuryPermissions(NO_ROLES)).toEqual({
      canManageTreasury: false,
      canManageTreasuryPlan: false,
      canManageTax: false,
      canManageBudgets: false,
    });
  });

  it("grants everything to an admin", () => {
    expect(resolveTreasuryPermissions({ ...NO_ROLES, isAdmin: true })).toEqual({
      canManageTreasury: true,
      canManageTreasuryPlan: true,
      canManageTax: true,
      canManageBudgets: true,
    });
  });

  it.each([
    ["chair", { ...NO_ROLES, isChair: true }],
    ["vice chair", { ...NO_ROLES, isViceChair: true }],
  ])("gives the %s tax + budgets but not the treasury plan", (_role, flags) => {
    expect(resolveTreasuryPermissions(flags)).toEqual({
      canManageTreasury: true,
      canManageTreasuryPlan: false,
      canManageTax: true,
      canManageBudgets: true,
    });
  });

  it("keeps the tax slider read-only for the treasurer", () => {
    expect(resolveTreasuryPermissions({ ...NO_ROLES, isTreasurer: true }).canManageTax).toBe(false);
  });

  it("lets the treasurer edit the treasury plan", () => {
    expect(
      resolveTreasuryPermissions({ ...NO_ROLES, isTreasurer: true }).canManageTreasuryPlan
    ).toBe(true);
  });

  // The PS Investment / GOTV / Suppression API routes all authorize the
  // treasurer — the UI gate must match so the treasurer can see the PS
  // "Total this turn" block (and the other budget levers) they are
  // allowed to set.
  it("lets the treasurer manage budgets (PS investment / GOTV / suppression)", () => {
    expect(resolveTreasuryPermissions({ ...NO_ROLES, isTreasurer: true }).canManageBudgets).toBe(
      true
    );
  });

  // When the Treasurer seat is vacant, the Chair / VC act as Treasurer and
  // gain the otherwise Treasurer-only Treasury Plan — matching the API guard.
  it.each([
    ["chair", { ...NO_ROLES, isChair: true, isTreasurerSeatVacant: true }],
    ["vice chair", { ...NO_ROLES, isViceChair: true, isTreasurerSeatVacant: true }],
  ])("lets the %s edit the treasury plan when the Treasurer seat is vacant", (_role, flags) => {
    expect(resolveTreasuryPermissions(flags).canManageTreasuryPlan).toBe(true);
  });

  it("does NOT grant the chair the treasury plan while a Treasurer is seated", () => {
    expect(
      resolveTreasuryPermissions({ ...NO_ROLES, isChair: true, isTreasurerSeatVacant: false })
        .canManageTreasuryPlan
    ).toBe(false);
  });

  it("a vacant seat alone (no chair/VC role) grants nothing extra", () => {
    expect(
      resolveTreasuryPermissions({ ...NO_ROLES, isTreasurerSeatVacant: true }).canManageTreasuryPlan
    ).toBe(false);
  });
});
