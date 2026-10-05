import { describe, expect, it } from "vitest";
import { buildOpeningDepartmentBoards1991 } from "../openingDepartmentBoards1991";
import { buildOpeningDepartmentTurnPlan } from "./departmentTurnPlan";

describe("1991 department authority turn plan", () => {
  const boards = buildOpeningDepartmentBoards1991("world-test", 1);

  it.each(boards)("reconciles $countryId annual authority across 48 turns", (board) => {
    const plans = Array.from({ length: 48 }, (_, index) =>
      buildOpeningDepartmentTurnPlan(board, index + 1)
    );
    expect(plans.every((plan) => plan.annualOperating === board.operating)).toBe(true);
    expect(plans.reduce((sum, plan) => sum + plan.periodOperating, 0)).toBe(board.operating);
    expect(plans.reduce((sum, plan) => sum + plan.continuityAuthority, 0)).toBe(
      board.continuityAmount
    );
    for (const account of board.accounts) {
      expect(
        plans.reduce(
          (sum, plan) =>
            sum + plan.accounts.find((entry) => entry.accountKey === account.key)!.periodAuthority,
          0
        )
      ).toBe(account.annualAllocation);
    }
  });

  it("charges a source family once even when accounts share a Cabinet seat", () => {
    const board = boards.find((row) => row.countryId === "US")!;
    const plan = buildOpeningDepartmentTurnPlan(board, 1);
    const familyKeys = plan.accounts.flatMap((account) => Object.keys(account.familyAuthority));
    expect(new Set(familyKeys).size).toBe(familyKeys.length);
    expect(plan.periodOperating).toBe(
      plan.continuityAuthority +
        plan.accounts.reduce((sum, account) => sum + account.periodAuthority, 0)
    );
  });

  it("rejects a stale or unreconciled opening", () => {
    const board = boards[0]!;
    expect(() => buildOpeningDepartmentTurnPlan(board, 0)).toThrow();
    expect(() =>
      buildOpeningDepartmentTurnPlan({ ...board, operating: board.operating + 1 }, 1)
    ).toThrow("treasury authority");
  });
});
