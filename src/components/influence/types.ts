import type { InfluenceType } from "@/lib/db/types";

export interface ElectionContext {
  id: string;
  label: string;
  state: string;
  type: string;
  senateClass?: number;
}

export interface CandidateContext {
  id: string;
  electionId: string;
  name: string;
  party: string;
  isNPP: boolean;
  politicalInfluence?: number;
}

export interface NPPCandidacy {
  electionId: string;
  candidateId: string;
  nppId?: string;
}

export interface NPPStats {
  favorability: number;
  politicalInfluence: number;
  loyalty: number;
  ambition: number;
  stubbornness: number;
}

export interface NPPOption {
  id: string;
  name: string;
  party: string;
  estimatedChance: number;
  stats: NPPStats;
  currentOfficeLabel?: string | null;
  activeCandidacyLabel?: string | null;
}

export interface ActionOption {
  type: InfluenceType;
  name: string;
  description: string;
  actionCost: number;
  baseFundCost: number;
  baseChance: number;
  available: boolean;
  unavailableReason?: string;
}

/**
 * Returns an action override when the currently selected NPP's stat is at the
 * cap/floor that the action targets. The party-influence server guards reject
 * these attempts with a 400; this helper short-circuits the UI so players
 * don't queue/execute pre-doomed work.
 *
 * Mirrors `checkTargetStatCap` in partyExecutorValidation.ts — keep these in
 * sync. Covers boost_favorability, boost_influence, boost_loyalty, and
 * reduce_stubbornness (the four stat-mutating party-influence actions).
 */
export function getStatCapOverride(
  actionType: InfluenceType,
  stats: NPPStats | null | undefined
): { available: false; unavailableReason: string } | null {
  if (!stats) return null;
  if (actionType === "boost_favorability" && stats.favorability >= 100) {
    return { available: false, unavailableReason: "Favorability already maxed (100%)." };
  }
  if (actionType === "boost_influence" && stats.politicalInfluence >= 100) {
    return { available: false, unavailableReason: "Political influence already maxed (100%)." };
  }
  if (actionType === "boost_loyalty" && stats.loyalty >= 100) {
    return { available: false, unavailableReason: "Loyalty already maxed (100%)." };
  }
  if (actionType === "reduce_stubbornness" && stats.stubbornness <= 0) {
    return { available: false, unavailableReason: "Stubbornness already at the floor (0%)." };
  }
  return null;
}
