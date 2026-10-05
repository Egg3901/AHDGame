import type { LegislationType } from "@/lib/db/types/legislation";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { RegionalProgramClaim } from "./rules/regionalSettlement";

/**
 * Defensive compatibility for legacy duplicate StatePolicy rows. Regional
 * finance must price and settle one current option per legislation type.
 */
export function latestRegionalPoliciesByType(policies: readonly StatePolicy[]): StatePolicy[] {
  const latest = new Map<string, StatePolicy>();
  for (const policy of policies) {
    const existing = latest.get(policy.legislationTypeId);
    if (
      !existing ||
      policy.enactedTurn > existing.enactedTurn ||
      (policy.enactedTurn === existing.enactedTurn && policy.enactedAt > existing.enactedAt)
    ) {
      latest.set(policy.legislationTypeId, policy);
    }
  }
  return [...latest.values()];
}

export function buildRegionalProgramClaims(input: {
  policies: StatePolicy[];
  legislationTypes: LegislationType[];
  annualCostByLegislationTypeId: ReadonlyMap<string, number>;
  previousProgramIds?: ReadonlySet<string>;
}): RegionalProgramClaim[] {
  const types = new Map(input.legislationTypes.map((type) => [type._id, type]));
  return input.policies.flatMap((policy): RegionalProgramClaim[] => {
    const type = types.get(policy.legislationTypeId);
    const option =
      type?.policyOptions?.find((candidate) => candidate.id === policy.policyOptionId) ??
      (typeof policy.policyOptionIndex === "number"
        ? type?.policyOptions?.[policy.policyOptionIndex]
        : undefined);
    const authorizedCost = Math.max(
      0,
      Math.round(input.annualCostByLegislationTypeId.get(policy.legislationTypeId) ?? 0)
    );
    const implementation = option?.implementation;
    const programId =
      implementation?.programId ??
      `${policy.legislationTypeId}:${option?.id ?? policy.policyOptionId ?? "current"}`;
    return [
      {
        programId,
        legislationTypeId: policy.legislationTypeId,
        policyOptionId: option?.id ?? policy.policyOptionId ?? "current",
        authorizedCost,
        obligationPriority: implementation?.obligationPriority ?? 5,
        fundingSemantics: implementation?.fundingSemantics ?? "appropriation_included",
        continuing: input.previousProgramIds?.has(programId) === true,
      },
    ];
  });
}
