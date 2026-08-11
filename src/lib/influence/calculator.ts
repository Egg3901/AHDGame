import type { Character, NPP, NPPRelationship, InfluenceType } from "@/lib/db/types";
import { INFLUENCE_ACTIONS, INFLUENCE_LIMITS, INFLUENCE_MODIFIERS } from "./constants";

export interface InfluenceCalculation {
  baseChance: number;
  stubbornnessPenalty: number;
  partyBonus: number;
  politicalInfluenceBonus: number;
  favorabilityBonus: number;
  fundBonus: number;
  relationshipBonus: number;
  finalChance: number;
}

export interface InfluenceCalculationInput {
  character: Character;
  npp: NPP;
  influenceType: InfluenceType;
  fundsPaid: number;
  relationship: NPPRelationship | null;
}

export function calculateInfluenceChance(input: InfluenceCalculationInput): InfluenceCalculation {
  const { character, npp, influenceType, fundsPaid, relationship } = input;
  const actionConfig = INFLUENCE_ACTIONS[influenceType];

  const baseChance = actionConfig.baseChance;
  const stubbornnessPenalty = Math.round(
    npp.personality.stubbornness * INFLUENCE_MODIFIERS.STUBBORNNESS_PENALTY_MULTIPLIER
  );

  let partyBonus = 0;
  const sameParty =
    character.party === npp.party && (character.countryId ?? "US") === (npp.countryId ?? "US");
  if (sameParty) {
    partyBonus = INFLUENCE_MODIFIERS.SAME_PARTY_BONUS;
  } else if (character.party !== "independent" && npp.party !== "independent") {
    partyBonus = INFLUENCE_MODIFIERS.CROSS_PARTY_PENALTY;
  }

  const politicalInfluenceBonus = Math.min(
    INFLUENCE_MODIFIERS.MAX_POLITICAL_INFLUENCE_BONUS,
    Math.round(
      (character.politicalInfluence || 0) / INFLUENCE_MODIFIERS.POLITICAL_INFLUENCE_DIVISOR
    )
  );

  const favorabilityBonus = Math.min(
    INFLUENCE_MODIFIERS.MAX_FAVORABILITY_BONUS,
    Math.round(character.favorability / INFLUENCE_MODIFIERS.FAVORABILITY_DIVISOR)
  );

  const fundBonus = Math.min(
    INFLUENCE_LIMITS.MAX_FUND_BONUS,
    Math.floor(fundsPaid / 50000) * INFLUENCE_LIMITS.FUND_BONUS_PER_50K
  );

  const relationshipScore = relationship?.relationshipScore || 0;
  const relationshipBonus = Math.round(
    relationshipScore * INFLUENCE_MODIFIERS.RELATIONSHIP_BONUS_MULTIPLIER
  );

  let finalChance =
    baseChance -
    stubbornnessPenalty +
    partyBonus +
    politicalInfluenceBonus +
    favorabilityBonus +
    fundBonus +
    relationshipBonus;

  finalChance = Math.max(
    INFLUENCE_LIMITS.MIN_SUCCESS_CHANCE,
    Math.min(INFLUENCE_LIMITS.MAX_SUCCESS_CHANCE, finalChance)
  );

  return {
    baseChance,
    stubbornnessPenalty,
    partyBonus,
    politicalInfluenceBonus,
    favorabilityBonus,
    fundBonus,
    relationshipBonus,
    finalChance: Math.round(finalChance),
  };
}

export function rollInfluence(): number {
  return Math.floor(Math.random() * 100) + 1;
}

export function determineOutcome(
  roll: number,
  finalChance: number
): "success" | "failure" | "backfire" {
  if (roll <= finalChance) return "success";
  if (roll >= INFLUENCE_LIMITS.BACKFIRE_THRESHOLD) return "backfire";
  return "failure";
}

export function getOutcomeMessage(
  outcome: "success" | "failure" | "backfire",
  nppName: string,
  influenceType: InfluenceType
): string {
  const actionConfig = INFLUENCE_ACTIONS[influenceType];

  switch (outcome) {
    case "success":
      switch (influenceType) {
        case "endorse_candidate":
          return `${nppName} has agreed to endorse your candidate!`;
        case "withdraw_election":
          return `${nppName} has agreed to withdraw from the election.`;
        case "oppose_candidate":
          return `${nppName} has agreed to speak against the candidate.`;
        case "support_leadership":
          return `${nppName} has agreed to support your leadership bid.`;
        default:
          return `${nppName} has agreed to your request.`;
      }
    case "failure":
      return `${nppName} politely declined your request for ${actionConfig.name.toLowerCase()}.`;
    case "backfire":
      return `${nppName} was offended by your approach and is now less likely to work with you in the future.`;
  }
}

export function getRelationshipChange(outcome: "success" | "failure" | "backfire"): number {
  switch (outcome) {
    case "success":
      return INFLUENCE_LIMITS.RELATIONSHIP_CHANGE_SUCCESS;
    case "failure":
      return INFLUENCE_LIMITS.RELATIONSHIP_CHANGE_FAILURE;
    case "backfire":
      return INFLUENCE_LIMITS.RELATIONSHIP_CHANGE_BACKFIRE;
  }
}
