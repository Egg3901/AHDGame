/** A Cabinet instruction changes requests inside one existing account, not treasury authority. */
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { resetLawFamilyById } from "@/lib/resetLegislation/catalog";
import {
  activeDepartmentProgramFamilyIds,
  activeDepartmentProgramFundingControl,
  type CurrentNationalLawProgram,
} from "./programRoster";

export type ResetAllocationValidation =
  { ok: true; allocations: Record<string, number> } | { ok: false; reason: string };

export function validateResetDepartmentAllocations(
  account: ResetDepartmentAccountSnapshot,
  allocations: Readonly<Record<string, number>>,
  currentPrograms: readonly CurrentNationalLawProgram[] = []
): ResetAllocationValidation {
  if (account.externallySettled) {
    return { ok: false, reason: "This department uses its specialized treasury controls" };
  }
  const families = activeDepartmentProgramFamilyIds(account, currentPrograms);
  const requested = Object.keys(allocations).sort();
  if (
    families.length === 0 ||
    families.length !== requested.length ||
    families.some((familyId, index) => familyId !== requested[index])
  ) {
    return { ok: false, reason: "Submit one allocation for every active law family" };
  }
  for (const [familyId, percent] of Object.entries(allocations)) {
    const programName = resetLawFamilyById(familyId)?.title ?? "This program";
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 200) {
      return { ok: false, reason: `Invalid allocation for ${programName}` };
    }
    const control = activeDepartmentProgramFundingControl(account, familyId, currentPrograms);
    if (control !== "adjustable" && percent !== 100) {
      return {
        ok: false,
        reason:
          control === "required"
            ? `${programName} is required by law and must remain at 100%`
            : `${programName} has no discretionary Cabinet allocation`,
      };
    }
  }
  return {
    ok: true,
    allocations: Object.fromEntries(requested.map((id) => [id, allocations[id]!])),
  };
}
