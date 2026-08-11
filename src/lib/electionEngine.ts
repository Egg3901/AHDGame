/**
 * Election Engine
 *
 * Shared logic for calculating how many votes each candidate can reach per
 * turn, using the same demographic weighting as the poll system.
 *
 * Vote accumulation model (Phase 1: Group-Level Competitive Allocation)
 * ────────────────────────────────────────────────────────────────────
 * Each demographic group's share of the turn pool is split among candidates
 * by relative appeal within that group. Groups vote as blocs; higher appeal
 * with a group yields a larger share of that group's votes.
 *
 * Per turn:
 *   1. Compute each group's contribution to the turn pool (groupPop x turnout x categoryWeight).
 *   2. For each group, split that contribution among candidates by relative
 *      (appeal x reach x approval x partyOrg) -- candidates compete within each bloc.
 *   3. Accumulate votes. The FINAL 4 turns are worth 25% of the pool; early turns share 75%.
 *
 * "totalPool" is derived from the state's total estimated turnout voters
 * (same number the poll shows as totalEstimatedVoters).
 *
 * This file re-exports all public symbols from focused sub-modules.
 * See src/lib/electionEngine/ for the implementation.
 */

// Constants
export {
  PARTY_STRENGTH_BY_OFFICE,
  FPTP_MAJOR_PARTIES,
  FPTP_SPOILER_RATE,
} from "./electionEngine/constants";

// Types & interfaces
export type {
  EnrichedCandidate,
  DistributeVotesOptions,
  AccumulateVoteTurnPreload,
} from "./electionEngine/types";

// Vote calculations
export {
  calcEffectiveFavorability,
  calcCandidateVotePotential,
  calcStateTurnout,
  turnVoteWeight,
  resolveTurnWindow,
} from "./electionEngine/voteCalculations";

// Vote distribution
export { distributeVotesByGroupLevelAllocation } from "./electionEngine/voteDistribution";

// Candidate enrichment
export { fetchEnrichedCandidates } from "./electionEngine/candidateEnrichment";

// Tally management
export { accumulateVoteTurn, initElectionVoteTally } from "./electionEngine/tallyManagement";

// Resolved turnout (unifies static demographics with dynamic GOTV/canvassing/suppression modifiers)
export {
  resolveTurnout,
  resolveSingleGroupTurnout,
  buildLiveTurnouts,
} from "./electionEngine/resolvedTurnout";
export type { ResolvedTurnout, ResolvedTurnoutOptions } from "./electionEngine/resolvedTurnout";
