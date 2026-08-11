// UI-facing query surface for party-influence calculations.
//
// Re-exports from @/lib/turn/partyInfluenceTurn so UI consumers don't reach
// into the turn engine directly. Keep this file thin — extend only when the UI
// really needs another calculation, and prefer extracting the calculation here
// rather than inviting deeper turn-engine coupling.

export {
  DEFAULT_PARTY_INFLUENCE_MAX_BONUS,
  DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER,
  computeClosenessScalar,
  computeLeadershipBonus,
  computeInfamyPenalty,
  computeTurnGain,
  computeBonusActions,
} from "@/lib/turn/partyInfluenceTurn";
