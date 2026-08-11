/**
 * Pure NPC scoring function — design Section 6.3.
 *
 * score =
 *   NPC_BASELINE_PREFERENCE[option] +
 *   NPC_GOVERNMENT_MODIFIER[country.governmentType][option] +
 *   NPC_IDEOLOGY_MODIFIER[leader.ideology][option] +
 *   stateModifiers(country, option);
 *
 * No RNG, no DB. Deterministic.
 */

import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import type { NpcCountryState, NpcExecutiveProfile } from "./types";
import {
  NPC_BASELINE_PREFERENCE,
  NPC_GOVERNMENT_MODIFIER,
  NPC_IDEOLOGY_MODIFIER,
  NPC_DGDP_HIGH_THRESHOLD,
  NPC_DGDP_VERY_HIGH_THRESHOLD,
  NPC_DGDP_REPUDIATE_BUMP,
  NPC_RESERVE_CURRENCY_MONETIZE_BUMP,
  NPC_LOW_INFLATION_THRESHOLD_PCT,
  NPC_LOW_INFLATION_MONETIZE_BUMP,
  NPC_RECENT_DEFAULT_TURNS,
  NPC_RECENT_DEFAULT_REPUDIATE_PENALTY,
  NPC_RECENT_DEFAULT_BAILOUT_PENALTY,
  NPC_FX_DEPRECIATION_THRESHOLD,
  NPC_FX_DEPRECIATION_MONETIZE_PENALTY,
} from "./npcConstants";

export function scoreNpcOption(
  option: SovereignResolutionChoice,
  state: NpcCountryState,
  leader: NpcExecutiveProfile
): number {
  let score =
    NPC_BASELINE_PREFERENCE[option] +
    NPC_GOVERNMENT_MODIFIER[leader.governmentType][option] +
    NPC_IDEOLOGY_MODIFIER[leader.ideology][option];

  if (option === "repudiate") {
    if (state.debtToGdp > NPC_DGDP_HIGH_THRESHOLD) score += NPC_DGDP_REPUDIATE_BUMP;
    if (state.debtToGdp > NPC_DGDP_VERY_HIGH_THRESHOLD) score += NPC_DGDP_REPUDIATE_BUMP;
    if (
      state.turnsSinceLastDefault !== null &&
      state.turnsSinceLastDefault < NPC_RECENT_DEFAULT_TURNS
    ) {
      score -= NPC_RECENT_DEFAULT_REPUDIATE_PENALTY;
    }
  }
  if (option === "monetize") {
    if (state.hasReserveCurrency) score += NPC_RESERVE_CURRENCY_MONETIZE_BUMP;
    if (state.inflationRatePct < NPC_LOW_INFLATION_THRESHOLD_PCT) {
      score += NPC_LOW_INFLATION_MONETIZE_BUMP;
    }
    if (state.fxDepreciationFraction > NPC_FX_DEPRECIATION_THRESHOLD) {
      score -= NPC_FX_DEPRECIATION_MONETIZE_PENALTY;
    }
  }
  if (option === "bailout") {
    if (
      state.turnsSinceLastDefault !== null &&
      state.turnsSinceLastDefault < NPC_RECENT_DEFAULT_TURNS
    ) {
      score -= NPC_RECENT_DEFAULT_BAILOUT_PENALTY;
    }
  }

  return score;
}
