/**
 * Pure simple-majority tally for a sovereign-crisis legislative chamber.
 *
 * Rule: votesFor > votesAgainst → passed; otherwise rejected.
 *
 * Tied votes and zero-zero (no legislator voted) both fail — matches design's
 * auto-Repudiate-on-deadlock semantic. Phase 10 calibration can layer in
 * quorum + abstention rules.
 */

import type { LegislativePhase } from "./types";

export function tallyChamberOutcome(
  phase: Pick<LegislativePhase, "votesFor" | "votesAgainst">
): "passed" | "rejected" {
  return phase.votesFor > phase.votesAgainst ? "passed" : "rejected";
}
