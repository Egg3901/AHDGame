import type { RegionalProgramClaim } from "@/lib/governmentFinance/rules/regionalSettlement";
import type { ResetLawProgramDocument } from "../program";

/**
 * Convert enacted v2 regional laws into the same cabinet-free claims used by
 * legacy state and regional programs. Regional governments have no Cabinet
 * account layer, so the enacted allocation is the authorized annual claim.
 */
export function buildResetRegionalProgramClaims(input: {
  programs: readonly ResetLawProgramDocument[];
  previousProgramIds?: ReadonlySet<string>;
}): RegionalProgramClaim[] {
  return input.programs.map((program) => ({
    programId: program._id,
    legislationTypeId: program.familyId,
    policyOptionId: program.choice,
    authorizedCost: Math.max(0, Math.round(program.annualAgencyAllocation)),
    obligationPriority: 5,
    fundingSemantics: "appropriation_included",
    continuing: input.previousProgramIds?.has(program._id) === true,
  }));
}
