/** A Cabinet instruction changes requests inside one existing account, not treasury authority. */
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";

export type ResetAllocationValidation =
  { ok: true; allocations: Record<string, number> } | { ok: false; reason: string };

export function validateResetDepartmentAllocations(
  account: ResetDepartmentAccountSnapshot,
  allocations: Readonly<Record<string, number>>
): ResetAllocationValidation {
  if (account.externallySettled) {
    return { ok: false, reason: "This department uses its specialized treasury controls" };
  }
  const families = Object.keys(account.familyAnnualDemand).sort();
  const requested = Object.keys(allocations).sort();
  if (
    families.length === 0 ||
    families.length !== requested.length ||
    families.some((familyId, index) => familyId !== requested[index])
  ) {
    return { ok: false, reason: "Submit one allocation for every active law family" };
  }
  for (const [familyId, percent] of Object.entries(allocations)) {
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 200) {
      return { ok: false, reason: `Invalid allocation for ${familyId}` };
    }
  }
  return {
    ok: true,
    allocations: Object.fromEntries(requested.map((id) => [id, allocations[id]!])),
  };
}
