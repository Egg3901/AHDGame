/**
 * Population recovery distinguishes frozen, completed and unpublished turn plans.
 * demographicRecoveryDecision only retries a missing plan when a durable attempt
 * proves that the interrupted phase used the receipt before making stock writes.
 */
export type DemographicFlowReceiptStatus = "ready" | "complete";

export type DemographicRecoveryDecision =
  "rerun" | "skip-legacy" | "resume-before-context" | "skip";

export function demographicFlowBatchId(worldEpochId: string, turn: number): string {
  return `${worldEpochId}:demographicFlows:${turn}`;
}

export function demographicRecoveryDecision(
  status: DemographicFlowReceiptStatus | "missing",
  journalAttemptStarted: boolean
): DemographicRecoveryDecision {
  if (status === "missing") {
    return journalAttemptStarted ? "rerun" : "skip-legacy";
  }
  if (status === "ready") return "resume-before-context";
  return "skip";
}
