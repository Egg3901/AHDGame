import type { ElectionVoteTally } from "@/lib/db/types";

export type PresidentialResolutionMode = "majority" | "contingent" | "contingent_deadlock";

/** Client-safe contingent breakdown mirrored from ElectionVoteTally.contingentResult. */
export type ContingentElectionDisplay = NonNullable<ElectionVoteTally["contingentResult"]>;

/** Modern 538-college majority; display fallback when no live college is known. */
export const PRESIDENTIAL_EV_NEEDED = 270;

/**
 * Majority threshold for an Electoral College of `totalEv` electors: more than
 * half. Modern 538 -> 270; the 1953-60 era college of 531 -> 266. Client-safe
 * (pure); the turn engine re-exports this for resolution.
 */
export function electoralMajorityFor(totalEv: number): number {
  if (!Number.isFinite(totalEv) || totalEv <= 0) return PRESIDENTIAL_EV_NEEDED;
  return Math.floor(totalEv / 2) + 1;
}

/** College size from a per-state EV map; 0 when absent/empty. */
export function collegeSizeFromEvByState(
  evByState: Record<string, number> | undefined | null
): number {
  if (!evByState) return 0;
  return Object.values(evByState).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

export interface ContingentEvRiskAssessment {
  atRisk: boolean;
  leaderId: string | null;
  leaderEv: number;
  secondEv: number;
  evNeeded: number;
}

/** Live-race signal: current EV projection may not produce an outright majority. */
export function assessContingentEvRisk(
  electoralVotesByCandidate: Record<string, number> | undefined,
  evNeeded = PRESIDENTIAL_EV_NEEDED
): ContingentEvRiskAssessment | null {
  if (!electoralVotesByCandidate || Object.keys(electoralVotesByCandidate).length === 0) {
    return null;
  }
  const ranked = Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1]);
  const [leaderId, leaderEv] = ranked[0];
  const secondEv = ranked.length > 1 ? ranked[1][1] : 0;
  return {
    atRisk: leaderEv < evNeeded,
    leaderId,
    leaderEv,
    secondEv,
    evNeeded,
  };
}

/** Live-race projection of the contingent ballot, built server-side by `contingentProjection`. */
export interface ContingentProjectionDisplay {
  /**
   * `founding`: no Congress seated yet, the chambers being elected now vote.
   * `incoming`: every House delegation comes from a race resolving first.
   * `mixed`: some delegations are sitting members with no race in the window.
   * `sitting`: no chamber race resolves first; the seated Congress votes.
   */
  basis: "founding" | "incoming" | "mixed" | "sitting";
  presidentWinnerId: string;
  /** True when no candidate reached the delegation majority and the EV tiebreak decided. */
  houseDeadlocked: boolean;
  houseVoteTotals: Record<string, number>;
  houseThreshold: number;
  /** Delegations that would cast a vote (non-empty, not tied). */
  delegationsVoting: number;
  houseRacesProjected: number;
  vicePresidentWinnerId: string | null;
  vicePresidentWinnerName: string | null;
  senateVoteTotals: Record<string, number>;
  senateThreshold: number;
  senateDeadlocked: boolean;
}

export function isContingentResolutionMode(
  mode: PresidentialResolutionMode | undefined
): mode is "contingent" | "contingent_deadlock" {
  return mode === "contingent" || mode === "contingent_deadlock";
}

/**
 * Resolve the seated president's election-candidate id for display.
 * EV plurality alone is wrong when resolutionMode is contingent.
 */
export function resolvePresidentialWinnerCandidateId(
  electoralVotesByCandidate: Record<string, number> | undefined,
  resolutionMode: PresidentialResolutionMode | undefined,
  contingentResult: ContingentElectionDisplay | undefined,
  evNeeded = PRESIDENTIAL_EV_NEEDED
): string | null {
  if (isContingentResolutionMode(resolutionMode)) {
    return contingentResult?.presidentWinnerId ?? null;
  }
  if (!electoralVotesByCandidate) return null;
  const ranked = Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [topId, topEv] = ranked[0];
  return topEv >= evNeeded ? topId : null;
}
