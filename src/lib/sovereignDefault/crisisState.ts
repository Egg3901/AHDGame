/**
 * Pure state-transition rules for the sovereign-default crisis state machine.
 *
 * Decoupled from DB and clock to make rule audits exhaustive. The orchestrator
 * (`crisisDetection.ts`) supplies the post-delta counter and the outcome; this
 * module owns the transition table.
 *
 * Phase 4 only handles entry into `crisisPending`. The post-warning states
 * (`crisisPending`, `crisisResolving`, `recovering`) are terminal-for-detection
 * — Phase 5+ owns transitions out of them.
 */

import type { SovereignCrisisState } from "@/lib/db/types/budget";
import type { AuctionOutcome } from "./auctionOutcome";
import { FAILED_AUCTION_COUNT_FOR_CRISIS } from "./constants";

export interface CrisisStateInput {
  current: SovereignCrisisState;
  outcome: AuctionOutcome;
  /** Counter value AFTER the orchestrator applied the auction-outcome delta. */
  newConsecutiveFailedCount: number;
}

export interface CrisisStateTransition {
  nextState: SovereignCrisisState;
  /** True iff state moved into `crisisPending` this evaluation. */
  firedThisEvaluation: boolean;
}

export function computeNextCrisisState(input: CrisisStateInput): CrisisStateTransition {
  const { current, outcome, newConsecutiveFailedCount } = input;

  if (current === "crisisPending" || current === "crisisResolving" || current === "recovering") {
    return { nextState: current, firedThisEvaluation: false };
  }

  if (outcome === "fullySubscribed") {
    return { nextState: "normal", firedThisEvaluation: false };
  }

  if (outcome === "undersubscribed") {
    return { nextState: "warning", firedThisEvaluation: false };
  }

  // outcome === "failed"
  if (newConsecutiveFailedCount >= FAILED_AUCTION_COUNT_FOR_CRISIS) {
    return { nextState: "crisisPending", firedThisEvaluation: true };
  }
  return { nextState: "warning", firedThisEvaluation: false };
}
