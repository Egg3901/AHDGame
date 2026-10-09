import { highDesireElectionBonus, isUKDevolutionRegion } from "@/lib/constants/devolution";

export interface HighDesireBonusCandidate {
  id: string;
  partyId: string;
}

/**
 * Apply the stepped high-desire vote bonus to the current First Minister's
 * party when the office is explicitly pursuing independence or reunification.
 *
 * Plain data in, plain data out so election hosts outside the server process
 * can use the same rule.
 */
export function applyFirstMinisterHighDesireBonus(args: {
  effectiveVotes: Record<string, number>;
  candidates: HighDesireBonusCandidate[];
  desire: number;
  region: string;
  firstMinisterPartyId: string | null;
  devolutionPolicy: "anti" | "pro" | "independence" | null;
}): { adjustedVotes: Record<string, number>; bonusApplied: number } {
  const { effectiveVotes, candidates, desire, region, firstMinisterPartyId, devolutionPolicy } =
    args;

  if (!isUKDevolutionRegion(region)) {
    return { adjustedVotes: effectiveVotes, bonusApplied: 0 };
  }
  if (
    !firstMinisterPartyId ||
    firstMinisterPartyId === "independent" ||
    devolutionPolicy !== "independence"
  ) {
    return { adjustedVotes: effectiveVotes, bonusApplied: 0 };
  }

  const bonus = highDesireElectionBonus(desire);
  if (bonus === 0) return { adjustedVotes: effectiveVotes, bonusApplied: 0 };

  const beneficiaryIds = candidates
    .filter((candidate) => candidate.partyId === firstMinisterPartyId)
    .map((candidate) => candidate.id);
  if (beneficiaryIds.length === 0) {
    return { adjustedVotes: effectiveVotes, bonusApplied: 0 };
  }

  const adjusted = { ...effectiveVotes };
  for (const id of beneficiaryIds) {
    adjusted[id] = (adjusted[id] ?? 0) * (1 + bonus);
  }

  return { adjustedVotes: adjusted, bonusApplied: bonus };
}
