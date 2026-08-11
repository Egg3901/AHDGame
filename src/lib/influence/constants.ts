import type { InfluenceType } from "@/lib/db/types";

export interface InfluenceActionConfig {
  type: InfluenceType;
  name: string;
  description: string;
  actionCost: number;
  baseFundCost: number;
  baseChance: number;
  requiresElection: boolean;
  requiresCandidate: boolean;
  nppMustBeCandidate: boolean;
}

export const INFLUENCE_ACTIONS: Record<InfluenceType, InfluenceActionConfig> = {
  boost_favorability: {
    type: "boost_favorability",
    name: "Boost Favorability",
    description: "Run a campaign to increase the NPP's public favorability",
    actionCost: 3,
    baseFundCost: 25000,
    baseChance: 50,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
  boost_influence: {
    type: "boost_influence",
    name: "Boost Political Influence",
    description: "Help the NPP expand their political connections and influence",
    actionCost: 3,
    baseFundCost: 50000,
    baseChance: 45,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
  boost_loyalty: {
    type: "boost_loyalty",
    name: "Strengthen Party Loyalty",
    description: "Reinforce the NPP's commitment and loyalty to the party",
    actionCost: 3,
    baseFundCost: 10000,
    baseChance: 55,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
  reduce_stubbornness: {
    type: "reduce_stubbornness",
    name: "Improve Cooperation",
    description: "Work with the NPP to make them more receptive to party guidance",
    actionCost: 3,
    baseFundCost: 20000,
    baseChance: 40,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
  relocate_state: {
    type: "relocate_state",
    name: "Request Relocation",
    description: "Ask the NPP to move their home state to strengthen party coverage elsewhere",
    actionCost: 0,
    baseFundCost: 0,
    baseChance: 35,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
  endorse_candidate: {
    type: "endorse_candidate",
    name: "Request Endorsement",
    description: "Convince the NPP to publicly endorse a candidate in an election",
    actionCost: 3,
    baseFundCost: 0,
    baseChance: 40,
    requiresElection: true,
    requiresCandidate: true,
    nppMustBeCandidate: false,
  },
  withdraw_election: {
    type: "withdraw_election",
    name: "Request Withdrawal",
    description: "Convince the NPP to withdraw from an election they are running in",
    actionCost: 3,
    baseFundCost: 50000,
    baseChance: 25,
    requiresElection: true,
    requiresCandidate: false,
    nppMustBeCandidate: true,
  },
  oppose_candidate: {
    type: "oppose_candidate",
    name: "Request Opposition",
    description: "Convince the NPP to publicly speak against a candidate",
    actionCost: 3,
    baseFundCost: 25000,
    baseChance: 35,
    requiresElection: true,
    requiresCandidate: true,
    nppMustBeCandidate: false,
  },
  support_leadership: {
    type: "support_leadership",
    name: "Request Leadership Support",
    description: "Convince the NPP to support a party leadership candidate",
    actionCost: 3,
    baseFundCost: 0,
    baseChance: 45,
    requiresElection: false,
    requiresCandidate: false,
    nppMustBeCandidate: false,
  },
};

export const INFLUENCE_LIMITS = {
  PER_NPP_COOLDOWN_TURNS: 2,
  MAX_ATTEMPTS_PER_TURN: 3,
  MIN_SUCCESS_CHANCE: 5,
  MAX_SUCCESS_CHANCE: 85,
  FUND_BONUS_PER_50K: 5,
  MAX_FUND_BONUS: 15,
  MIN_RELATIONSHIP: -100,
  MAX_RELATIONSHIP: 100,
  RELATIONSHIP_CHANGE_SUCCESS: 10,
  RELATIONSHIP_CHANGE_FAILURE: -5,
  RELATIONSHIP_CHANGE_BACKFIRE: -25,
  BACKFIRE_THRESHOLD: 95,
};

export const INFLUENCE_MODIFIERS = {
  STUBBORNNESS_PENALTY_MULTIPLIER: 0.4,
  SAME_PARTY_BONUS: 20,
  CROSS_PARTY_PENALTY: -10,
  POLITICAL_INFLUENCE_DIVISOR: 5,
  MAX_POLITICAL_INFLUENCE_BONUS: 15,
  FAVORABILITY_DIVISOR: 10,
  MAX_FAVORABILITY_BONUS: 10,
  RELATIONSHIP_BONUS_MULTIPLIER: 0.15,
};
