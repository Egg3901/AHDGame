import type { NPP } from "@/lib/db/types";
import { INFLUENCE_ACTIONS, INFLUENCE_LIMITS } from "./constants";
import type { InfluenceType, InfluenceOutcome } from "@/lib/db/types";
import { computeSlateAssignmentScore } from "@/lib/slateAssignments";

export interface PartyInfluenceCalculation {
  baseChance: number;
  stubbornnessPenalty: number;
  partyBonus: number;
  organizationBonus: number;
  fundBonus: number;
  finalChance: number;
}

export function calculatePartyInfluenceChance(
  npp: NPP,
  partyId: string,
  organizationLevel: number,
  _fundsPaid: number,
  hiddenBonus = 0
): PartyInfluenceCalculation {
  const loyalty = npp.personality.loyalty;
  const stubbornness = npp.personality.stubbornness;
  // National party influence should feel a bit softer than hard Slate gates:
  // loyal NPPs are slightly easier to persuade and stubbornness bites a touch
  // less harshly, while the final chance still respects the same broad stat
  // language players already learned from the Slate system.
  const baseChance = Math.round(loyalty * 0.65 + 38);
  const stubbornnessPenalty = Math.round(stubbornness * 0.32);

  let partyBonus = 0;
  if (partyId === npp.party) {
    partyBonus = 0;
  } else if (partyId !== "independent" && npp.party !== "independent") {
    partyBonus = -15;
  }

  // Mirror the slate acceptance model: loyalty increases willingness while
  // stubbornness resists direction, with only a light organization-level nudge.
  const organizationBonus = Math.round((organizationLevel - 50) * 0.1);
  const fundBonus = 0;

  let finalChance =
    baseChance - stubbornnessPenalty + partyBonus + organizationBonus + fundBonus + hiddenBonus;
  finalChance = Math.max(
    INFLUENCE_LIMITS.MIN_SUCCESS_CHANCE,
    Math.min(INFLUENCE_LIMITS.MAX_SUCCESS_CHANCE, finalChance)
  );

  return {
    baseChance,
    stubbornnessPenalty,
    partyBonus,
    organizationBonus,
    fundBonus,
    finalChance: Math.round(Math.max(finalChance, computeSlateAssignmentScore(npp))),
  };
}

export function getPartyOutcomeMessage(
  outcome: InfluenceOutcome,
  nppName: string,
  influenceType: InfluenceType,
  partyName: string,
  statChange?: number
): string {
  const actionConfig = INFLUENCE_ACTIONS[influenceType];

  switch (outcome) {
    case "success":
      switch (influenceType) {
        case "boost_favorability":
          return `${nppName}'s favorability has increased by ${statChange}! The ${partyName}'s campaign was successful.`;
        case "boost_influence":
          return `${nppName}'s political influence has increased by ${statChange}! The ${partyName}'s efforts paid off.`;
        case "boost_loyalty":
          return `${nppName}'s loyalty has increased by ${statChange}! They are more committed to the ${partyName}.`;
        case "reduce_stubbornness":
          return `${nppName}'s stubbornness has decreased by ${statChange}! They are more receptive to the ${partyName}'s guidance.`;
        case "relocate_state":
          return `${nppName} has agreed to relocate at the ${partyName}'s request.`;
        case "endorse_candidate":
          return `${nppName} has agreed to endorse the ${partyName}'s candidate!`;
        case "withdraw_election":
          return `${nppName} has agreed to withdraw from the election at the ${partyName}'s request.`;
        case "oppose_candidate":
          return `${nppName} has agreed to oppose the candidate on behalf of the ${partyName}.`;
        case "support_leadership":
          return `${nppName} has pledged support to the ${partyName}'s leadership.`;
        default:
          return `${nppName} has agreed to the ${partyName}'s request.`;
      }
    case "failure":
      return `${nppName} politely declined the ${partyName}'s request for ${actionConfig.name.toLowerCase()}.`;
    case "backfire":
      return `${nppName} was offended by the ${partyName}'s approach.`;
  }
}
