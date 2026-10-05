import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import type { ResetDepartmentOpeningBoard } from "./departmentBoard";

export interface DepartmentPeriodAuthority {
  accountKey: string;
  seatId: string;
  agencyName: string;
  annualAuthority: number;
  periodAuthority: number;
  familyAuthority: Record<string, number>;
}

export interface DepartmentTurnPlan {
  countryId: ResetDepartmentOpeningBoard["countryId"];
  turn: number;
  annualOperating: number;
  periodOperating: number;
  continuityAuthority: number;
  accounts: DepartmentPeriodAuthority[];
}

/**
 * Divide an existing national operating line into department authority and
 * separately booked continuity. The sum is the treasury charge, not an extra
 * expense. Each annual source line sums exactly over a complete 48-turn year.
 */
export function buildOpeningDepartmentTurnPlan(
  board: ResetDepartmentOpeningBoard,
  turn: number
): DepartmentTurnPlan {
  if (!Number.isSafeInteger(turn) || turn < board.sourceTurn) {
    throw new Error("Department turn must follow the opening board");
  }
  const seen = new Set<string>();
  const accounts = board.accounts.map((account) => {
    if (seen.has(account.key)) throw new Error(`Duplicate department account ${account.key}`);
    seen.add(account.key);
    const familyAuthority = Object.fromEntries(
      Object.entries(account.familyAllocations).map(([familyId, amount]) => [
        familyId,
        includedAuthorityPerTurn(amount, turn),
      ])
    );
    const periodAuthority = Object.values(familyAuthority).reduce((sum, value) => sum + value, 0);
    if (
      Object.values(account.familyAllocations).reduce((sum, value) => sum + value, 0) !==
      account.annualAllocation
    ) {
      throw new Error(`Department source claims do not reconcile: ${account.key}`);
    }
    return {
      accountKey: account.key,
      seatId: account.seatId,
      agencyName: account.agencyName,
      annualAuthority: account.annualAllocation,
      periodAuthority,
      familyAuthority,
    };
  });
  const continuityAuthority = includedAuthorityPerTurn(board.continuityAmount, turn);
  const periodOperating =
    continuityAuthority + accounts.reduce((sum, account) => sum + account.periodAuthority, 0);
  const annualOperating =
    board.continuityAmount + accounts.reduce((sum, account) => sum + account.annualAuthority, 0);
  if (annualOperating !== board.operating) {
    throw new Error("Department operating plan exceeds or omits treasury authority");
  }
  return {
    countryId: board.countryId,
    turn,
    annualOperating,
    periodOperating,
    continuityAuthority,
    accounts,
  };
}
