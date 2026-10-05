import type { OpeningDepartmentAccount } from "./departmentOpening";

/** An opening claim, not a cash balance or a license to spend twice. */
export interface ResetDepartmentOpeningBoard {
  _id: string;
  worldId: string;
  countryId: "US" | "UK" | "JP";
  sourceTurn: number;
  operating: number;
  continuityAmount: number;
  accounts: OpeningDepartmentAccount[];
}

export function departmentOpeningBoardPayload(
  boards: readonly ResetDepartmentOpeningBoard[]
): string {
  const countries = new Set<string>();
  for (const board of boards) {
    if (
      board._id !== board.countryId ||
      !board.worldId ||
      countries.has(board.countryId) ||
      !Number.isSafeInteger(board.sourceTurn) ||
      board.sourceTurn < 1 ||
      !Number.isFinite(board.operating) ||
      board.operating < 0 ||
      !Number.isFinite(board.continuityAmount) ||
      board.continuityAmount < 0
    ) {
      throw new Error(`Invalid opening department board ${board._id}`);
    }
    countries.add(board.countryId);
    const accountKeys = new Set<string>();
    const families = new Set<string>();
    let owned = board.continuityAmount;
    for (const account of board.accounts) {
      if (
        account.key !== `${account.seatId}:${account.agencyName}` ||
        accountKeys.has(account.key) ||
        !account.seatId ||
        !account.agencyName ||
        !Number.isFinite(account.annualAllocation) ||
        account.annualAllocation < 0
      ) {
        throw new Error(`Invalid department account in ${board._id}`);
      }
      accountKeys.add(account.key);
      const familyClaims = Object.entries(account.familyAllocations);
      const familyAmounts = familyClaims.map(([, value]) => value);
      if (
        familyClaims.some(([familyId]) => !familyId || families.has(familyId)) ||
        familyAmounts.some((value) => !Number.isFinite(value) || value < 0) ||
        Math.abs(familyAmounts.reduce((sum, value) => sum + value, 0) - account.annualAllocation) >
          0.01
      ) {
        throw new Error(`Department family allocations do not reconcile in ${board._id}`);
      }
      familyClaims.forEach(([familyId]) => families.add(familyId));
      owned += account.annualAllocation;
    }
    if (Math.abs(owned - board.operating) > 0.01) {
      throw new Error(`Department opening does not reconcile in ${board._id}`);
    }
  }
  if (countries.size !== 3 || ["US", "UK", "JP"].some((country) => !countries.has(country))) {
    throw new Error("Opening department boards must cover US, UK, and JP exactly once");
  }
  return JSON.stringify(
    [...boards]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((board) => [
        board._id,
        board.worldId,
        board.countryId,
        board.sourceTurn,
        board.operating,
        board.continuityAmount,
        [...board.accounts]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((account) => [
            account.key,
            account.seatId,
            account.agencyName,
            account.annualAllocation,
            Object.entries(account.familyAllocations).sort(([a], [b]) => a.localeCompare(b)),
          ]),
      ])
  );
}
