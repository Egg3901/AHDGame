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

  const ordered = [...claims].sort((a, b) => a.programId.localeCompare(b.programId));
  const provisional = ordered.map((claim) => {
    const exact = (available * claim.authorizedCost) / demand;
    const amount = Math.min(claim.authorizedCost, Math.floor(exact));
    allocations.set(claim.programId, amount);
    return { claim, remainder: exact - amount };
  });
  let residual = available - [...allocations.values()].reduce((sum, amount) => sum + amount, 0);
  provisional.sort(
    (a, b) => b.remainder - a.remainder || a.claim.programId.localeCompare(b.claim.programId)
  );
  for (const { claim } of provisional) {
    if (residual === 0) break;
    const allocated = allocations.get(claim.programId) ?? 0;
    if (allocated < claim.authorizedCost) {
      allocations.set(claim.programId, allocated + 1);
      residual -= 1;
    }
  }
  return allocations;
}

function amount(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return Math.max(0, Math.round(value));
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
  const availableBudget = amount(input.availableBudget, "availableBudget");
  const reservedNonProgramSpending = Math.min(
    availableBudget,
    amount(input.reservedNonProgramSpending ?? 0, "reservedNonProgramSpending")
  );
  let remaining = availableBudget - reservedNonProgramSpending;
  const ids = new Set<string>();
  const validClaims = input.claims.flatMap((claim): RegionalProgramClaim[] => {
    if (!claim.programId) throw new Error("regional program id cannot be empty");
    if (ids.has(claim.programId)) {
      throw new Error(`duplicate regional program: ${claim.programId}`);
    }
    ids.add(claim.programId);
    if (
      !Number.isInteger(claim.obligationPriority) ||
      claim.obligationPriority < 1 ||
      claim.obligationPriority > 7
    ) {
      throw new Error(`invalid obligation priority: ${claim.programId}`);
    }
    const authorizedCost = amount(claim.authorizedCost, `${claim.programId}.authorizedCost`);
    return [{ ...claim, authorizedCost }];
  });
  const grouped = new Map<
    string,
    {
      mandatory: number;
      obligationPriority: number;
      continuity: number;
      claims: RegionalProgramClaim[];
    }
  >();
  for (const claim of validClaims) {
    const mandatory = claim.fundingSemantics === "standing_mandatory" ? 0 : 1;
    const continuity = claim.continuing ? 0 : 1;
    const key = `${mandatory}:${claim.obligationPriority}:${continuity}`;
    const tier = grouped.get(key) ?? {
      mandatory,
      obligationPriority: claim.obligationPriority,
      continuity,
      claims: [],
    };
    tier.claims.push(claim);
    grouped.set(key, tier);
  }

  const allocations = new Map<string, number>();
  const tiers = [...grouped.values()].sort(
    (a, b) =>
      a.mandatory - b.mandatory ||
      a.obligationPriority - b.obligationPriority ||
      a.continuity - b.continuity
  );
  for (const tier of tiers) {
    const demand = tier.claims.reduce((sum, claim) => sum + claim.authorizedCost, 0);
    const tierAllocations = allocateProRata(tier.claims, Math.min(remaining, demand));
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
