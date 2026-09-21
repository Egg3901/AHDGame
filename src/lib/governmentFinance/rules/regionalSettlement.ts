import type { FundingSemantics } from "@/lib/db/types/legislation";

export interface RegionalProgramClaim {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  authorizedCost: number;
  obligationPriority: number;
  fundingSemantics: FundingSemantics;
  continuing: boolean;
}

export interface RegionalProgramSettlement {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  authorizedCost: number;
  fundedAmount: number;
  unfundedAmount: number;
  implementationFactor: number;
  obligationPriority: number;
}

export interface RegionalBudgetSettlement {
  availableBudget: number;
  reservedNonProgramSpending: number;
  totalAuthorized: number;
  totalFunded: number;
  totalUnfunded: number;
  programs: RegionalProgramSettlement[];
}

function allocateProRata(claims: RegionalProgramClaim[], available: number): Map<string, number> {
  const allocations = new Map<string, number>();
  const demand = claims.reduce((sum, claim) => sum + claim.authorizedCost, 0);
  if (available <= 0 || demand <= 0) return allocations;
  if (available >= demand) {
    for (const claim of claims) allocations.set(claim.programId, claim.authorizedCost);
    return allocations;
  }

  let used = 0;
  const ordered = [...claims].sort((a, b) => a.programId.localeCompare(b.programId));
  for (let index = 0; index < ordered.length; index += 1) {
    const claim = ordered[index];
    const amount =
      index === ordered.length - 1
        ? Math.max(0, available - used)
        : Math.min(claim.authorizedCost, Math.floor((available * claim.authorizedCost) / demand));
    allocations.set(claim.programId, amount);
    used += amount;
  }
  return allocations;
}

/**
 * Cabinet-free regional funding rule. Non-program commitments reserve cash,
 * then legal obligation priority and continuity determine funding tiers.
 * Programs within the same tier share a shortfall proportionally.
 */
export function settleRegionalBudget(input: {
  availableBudget: number;
  reservedNonProgramSpending?: number;
  claims: RegionalProgramClaim[];
}): RegionalBudgetSettlement {
  const availableBudget = Math.max(0, Math.round(input.availableBudget));
  const reservedNonProgramSpending = Math.min(
    availableBudget,
    Math.max(0, Math.round(input.reservedNonProgramSpending ?? 0))
  );
  let remaining = availableBudget - reservedNonProgramSpending;
  const validClaims = input.claims
    .filter((claim) => claim.authorizedCost > 0)
    .map((claim) => ({ ...claim, authorizedCost: Math.round(claim.authorizedCost) }));
  const grouped = new Map<string, RegionalProgramClaim[]>();
  for (const claim of validClaims) {
    const mandatory = claim.fundingSemantics === "standing_mandatory" ? 0 : 1;
    const continuity = claim.continuing ? 0 : 1;
    const key = `${mandatory}:${continuity}`;
    const tier = grouped.get(key) ?? [];
    tier.push(claim);
    grouped.set(key, tier);
  }

  const allocations = new Map<string, number>();
  for (const key of [...grouped.keys()].sort()) {
    const tier = grouped.get(key)!;
    const demand = tier.reduce((sum, claim) => sum + claim.authorizedCost, 0);
    const tierAllocations = allocateProRata(tier, Math.min(remaining, demand));
    let spent = 0;
    for (const [programId, amount] of tierAllocations) {
      allocations.set(programId, amount);
      spent += amount;
    }
    remaining -= spent;
  }

  const programs = validClaims.map((claim): RegionalProgramSettlement => {
    const fundedAmount = allocations.get(claim.programId) ?? 0;
    return {
      programId: claim.programId,
      legislationTypeId: claim.legislationTypeId,
      policyOptionId: claim.policyOptionId,
      authorizedCost: claim.authorizedCost,
      fundedAmount,
      unfundedAmount: claim.authorizedCost - fundedAmount,
      implementationFactor:
        claim.authorizedCost > 0 ? Math.min(1, fundedAmount / claim.authorizedCost) : 1,
      obligationPriority: claim.obligationPriority,
    };
  });
  const programAuthorized = programs.reduce((sum, program) => sum + program.authorizedCost, 0);
  const programFunded = programs.reduce((sum, program) => sum + program.fundedAmount, 0);
  return {
    availableBudget,
    reservedNonProgramSpending,
    totalAuthorized: reservedNonProgramSpending + programAuthorized,
    totalFunded: reservedNonProgramSpending + programFunded,
    totalUnfunded: programAuthorized - programFunded,
    programs,
  };
}
