import type { CommodityType } from "@/lib/constants/commodities";
import type { CrisisTradeSanction, GlobalResponseRole } from "@/lib/db/types/crisis";

export interface SanctionParticipant {
  countryId: string;
  actorId: string;
  responseScores?: Record<string, number>;
}

export interface CrisisSanctionPlan {
  sourceCountry: string;
  targetCountry: string;
  createdBy: string;
  commodity: CommodityType;
  createdTurn: number;
  expiresTurn: number;
}

/** Only consenting responders restrict trade with the authored target role. */
export function planCrisisSanctions(
  sanction: CrisisTradeSanction,
  roles: Readonly<Record<string, GlobalResponseRole>>,
  responses: readonly SanctionParticipant[],
  eligibleCountries: ReadonlySet<string>,
  resolutionTurn: number
): CrisisSanctionPlan[] {
  if (
    !Number.isInteger(sanction.durationTurns) ||
    sanction.durationTurns <= 0 ||
    !Number.isFinite(resolutionTurn)
  ) {
    throw new Error("A crisis sanction requires a finite resolution turn and positive duration.");
  }
  const targets = Object.entries(roles)
    .filter(([country, role]) => role === sanction.targetRole && eligibleCountries.has(country))
    .map(([country]) => country);
  const plans = new Map<string, CrisisSanctionPlan>();
  for (const response of responses) {
    const score = response.responseScores?.[sanction.participationAxis] ?? 0;
    if (
      !eligibleCountries.has(response.countryId) ||
      !roles[response.countryId] ||
      !Number.isFinite(score) ||
      score <= 0
    )
      continue;
    for (const target of targets) {
      if (response.countryId === target) continue;
      const key = `${response.countryId}:${target}:${sanction.commodity}`;
      if (!plans.has(key))
        plans.set(key, {
          sourceCountry: response.countryId,
          targetCountry: target,
          createdBy: response.actorId,
          commodity: sanction.commodity,
          createdTurn: resolutionTurn,
          expiresTurn: resolutionTurn + sanction.durationTurns,
        });
    }
  }
  return [...plans.values()];
}
