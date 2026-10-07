/**
 * Lock takeover and setup boundaries of a crash-resumed turn (#3429).
 *
 * The crash evidence (target turn, last phase, phase statuses and stored phase
 * results) is the only record of what a dead holder already applied. Lock
 * acquisition leaves it untouched; it is validated against the freshly locked
 * document, then rewritten in full, with the inherited markers and results
 * already in place, by the turn's first status write. A crash anywhere in
 * between leaves the original evidence for the next holder.
 *
 * Plain data only. `processTurn` owns the writes.
 */
import type { GameState, TurnPhaseTelemetryMap } from "@/lib/db/types";
import { TURN_BOOTSTRAP_PHASE, turnHasCommittedWrites } from "@/lib/turn/processingLock";
import {
  TurnResumeRefusedError,
  encodeResumeResult,
  readCrashedTurnPhaseState,
  type CrashedTurnPhaseState,
} from "./turnPhaseResumeResults";

type RecoveryFields = Pick<
  GameState,
  | "currentTurn"
  | "processingTargetTurn"
  | "processingPhase"
  | "processingPhaseStatuses"
  | "processingPhaseResults"
>;

/** Lock fields only. Never the crash evidence the next step validates. */
export function lockAcquisitionSet(at: Date) {
  return {
    isProcessing: true,
    processingKind: "turn" as const,
    processingStartedAt: at,
    processingHeartbeatAt: at,
    // Never inherit the previous holder's abandon marker: this lock is live.
    processingAbandonedAt: null,
  };
}

export interface ValidatedTurnResume {
  targetTurn: number;
  lastPhase: string;
  /** Completed plus interrupted: neither may run again. */
  appliedPhases: Set<string>;
  phaseState: CrashedTurnPhaseState;
}

/**
 * Resume only when the pre-lock read and the locked document name the same
 * target, and that target is still the next turn. Phase state comes from the
 * locked document, never the pre-lock snapshot.
 */
export function validateLockedResume(
  locked: RecoveryFields,
  preLockTargetTurn: number | null
): ValidatedTurnResume | null {
  const target = locked.processingTargetTurn;
  if (typeof preLockTargetTurn !== "number" || target !== preLockTargetTurn) return null;
  if (target !== locked.currentTurn + 1) return null;
  if (!turnHasCommittedWrites(locked.processingPhase)) return null;
  const phaseState = readCrashedTurnPhaseState(
    locked.processingPhaseStatuses,
    locked.processingPhaseResults
  );
  return {
    targetTurn: target,
    lastPhase: locked.processingPhase!,
    appliedPhases: new Set([...phaseState.completed, ...phaseState.interrupted]),
    phaseState,
  };
}

/**
 * Next-turn evidence that proves phases already applied: the target is the turn
 * after `currentTurn`, the turn got past bootstrap, and at least one phase is
 * marked applied. Discarding it would rerun committed financial writes.
 */
export function hasAppliedNextTurnEvidence(state: RecoveryFields): boolean {
  if (state.processingTargetTurn !== state.currentTurn + 1) return false;
  if (!turnHasCommittedWrites(state.processingPhase)) return false;
  const phaseState = readCrashedTurnPhaseState(state.processingPhaseStatuses, null);
  return phaseState.completed.size + phaseState.interrupted.size > 0;
}

/**
 * A failed turn released by the ordinary failure path, which set
 * `isProcessing: false` and `processingKind: null` but kept the target, phase
 * and finalized statuses. The stale-lock gate never sees it, because there is
 * no lock, so it is recognised here. `processingKind` is deliberately not
 * required: that path cleared it. A completed turn clears its target and a
 * healthy lock is still held, so neither matches.
 */
export function isUnownedFailedTurn(state: RecoveryFields & Pick<GameState, "isProcessing">) {
  return state.isProcessing !== true && hasAppliedNextTurnEvidence(state);
}

/**
 * Evidence left by an earlier holder that does not describe a resumable turn.
 * Cleared before setup writes anything; skipped (no round trip) when absent.
 */
export function staleRecoveryEvidenceReset(locked: RecoveryFields) {
  // Applied next-turn evidence is never discarded, even when the resume did not
  // validate; the caller must stop instead.
  if (hasAppliedNextTurnEvidence(locked)) {
    throw new TurnResumeRefusedError(
      `Turn ${locked.processingTargetTurn} has phases already applied but did not validate ` +
        `as a resume; refusing to discard its evidence or rerun it. Repair required.`
    );
  }
  const present =
    locked.processingTargetTurn != null ||
    (locked.processingPhase != null && locked.processingPhase !== TURN_BOOTSTRAP_PHASE) ||
    locked.processingPhaseStatuses != null ||
    locked.processingPhaseResults != null;
  if (!present) return null;
  return {
    processingTargetTurn: null,
    processingPhase: TURN_BOOTSTRAP_PHASE,
    processingPhaseStatuses: null,
    processingPhaseResults: null,
  };
}

/**
 * Initial statuses and results for the turn's first status write. A resume
 * starts from the inherited markers and bounded results, so this write can
 * never erase them.
 */
export function bootstrapPhaseRecord(
  initial: TurnPhaseTelemetryMap,
  resume: ValidatedTurnResume | null,
  now: Date
): {
  statuses: TurnPhaseTelemetryMap;
  results: Record<string, Record<string, unknown>>;
} {
  const statuses = initial;
  const results: Record<string, Record<string, unknown>> = {};
  if (!resume) return { statuses, results };
  const carry = (phase: string, resumeCarried: "completed" | "interrupted") => {
    statuses[phase] = {
      status: "skipped",
      startedAt: null,
      completedAt: now,
      updatedAt: now,
      reason: "upstreamAbort",
      message: "skipped: already applied before crash",
      resumeCarried,
    };
  };
  for (const phase of resume.phaseState.completed) carry(phase, "completed");
  for (const phase of resume.phaseState.interrupted) carry(phase, "interrupted");
  for (const [phase, result] of Object.entries(resume.phaseState.results)) {
    const encoded = encodeResumeResult(phase, result);
    if (encoded) results[phase] = encoded;
  }
  return { statuses, results };
}
