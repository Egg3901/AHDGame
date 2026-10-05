/** Portable current-law roster for one v2 department account. */
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import {
  enactedLawFundingControl,
  openingLawFundingControl,
  type LawFundingControl,
} from "@/lib/resetLegislation/rules/fundingControl";

export type CurrentNationalLawProgram = Pick<
  ResetLawProgramDocument,
  "country" | "scope" | "familyId" | "choice" | "fundingAccountId"
>;

/**
 * Opening account keys are the complete family roster, including programs
 * whose 1991 law has no separately booked appropriation. A later enactment
 * overrides that opening destination. Regionalized families disappear from
 * the national account, while a replacement follows its current funder.
 */
export function activeDepartmentProgramFamilyIds(
  account: ResetDepartmentAccountSnapshot,
  currentPrograms: readonly CurrentNationalLawProgram[]
): string[] {
  const familyIds = new Set(Object.keys(account.familyAnnualDemand));

  for (const program of currentPrograms) {
    if (program.country !== account.countryId || program.scope !== "national") continue;
    if (program.choice === "leave_to_states" || program.fundingAccountId !== account._id) {
      familyIds.delete(program.familyId);
    } else {
      familyIds.add(program.familyId);
    }
  }

  return [...familyIds].sort((left, right) => left.localeCompare(right));
}

export function activeDepartmentProgramFundingControl(
  account: ResetDepartmentAccountSnapshot,
  familyId: string,
  currentPrograms: readonly CurrentNationalLawProgram[]
): LawFundingControl {
  const annualAllocation = account.familyAnnualDemand[familyId] ?? 0;
  const current = currentPrograms.find(
    (program) =>
      program.country === account.countryId &&
      program.scope === "national" &&
      program.familyId === familyId &&
      program.choice !== "leave_to_states" &&
      program.fundingAccountId === account._id
  );
  return current
    ? enactedLawFundingControl({ familyId, choice: current.choice, annualAllocation })
    : openingLawFundingControl({ country: account.countryId, familyId, annualAllocation });
}
