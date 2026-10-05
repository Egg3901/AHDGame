/** Portable allocation of reconciled source claims to accountable institutions. */
export interface OpeningDepartmentClaim {
  familyId: string;
  seatId: string;
  agencyName: string;
  annualAmount: number;
}

export interface OpeningDepartmentAccount {
  key: string;
  seatId: string;
  agencyName: string;
  annualAllocation: number;
  familyAllocations: Record<string, number>;
}

export function groupOpeningDepartmentClaims(
  operating: number,
  familyClaims: readonly OpeningDepartmentClaim[],
  continuityAmount: number
): { accounts: OpeningDepartmentAccount[]; continuityAmount: number } {
  if (
    !Number.isFinite(operating) ||
    operating < 0 ||
    !Number.isFinite(continuityAmount) ||
    continuityAmount < 0
  ) {
    throw new Error("Opening department totals must be finite and nonnegative");
  }
  const accounts = new Map<string, OpeningDepartmentAccount>();
  const families = new Set<string>();
  for (const claim of familyClaims) {
    if (
      !claim.familyId ||
      families.has(claim.familyId) ||
      !claim.seatId ||
      !claim.agencyName ||
      !Number.isFinite(claim.annualAmount) ||
      claim.annualAmount < 0
    ) {
      throw new Error(`Invalid opening department claim ${claim.familyId}`);
    }
    families.add(claim.familyId);
    const key = `${claim.seatId}:${claim.agencyName}`;
    const account = accounts.get(key) ?? {
      key,
      seatId: claim.seatId,
      agencyName: claim.agencyName,
      annualAllocation: 0,
      familyAllocations: {},
    };
    account.annualAllocation += claim.annualAmount;
    account.familyAllocations[claim.familyId] = claim.annualAmount;
    accounts.set(key, account);
  }
  const familyOwned = [...accounts.values()].reduce(
    (sum, account) => sum + account.annualAllocation,
    0
  );
  if (Math.abs(familyOwned + continuityAmount - operating) > 0.01) {
    throw new Error("Opening department allocations do not reconcile to operating claims");
  }
  return {
    accounts: [...accounts.values()].sort((a, b) => a.key.localeCompare(b.key)),
    continuityAmount,
  };
}
