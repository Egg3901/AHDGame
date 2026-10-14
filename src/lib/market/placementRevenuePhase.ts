import type { GameConfig } from "@/lib/db/types";

/**
 * Revenue follows placed output.
 *
 * Freight placement (`statePlacedSupply / stateSupply`) records what share of
 * a state's output found any buyer. Clearing shrinks each seller's offer by
 * that share, but the sold fraction it returns is measured against the
 * shrunken offer, so a plant whose output nobody bought still read "sold 100%"
 * and was paid for all of it. Over this many turns, the sold fraction moves
 * onto the placed share of physical output, so unsold production stops earning.
 */
export const PLACEMENT_REVENUE_PHASE_TURNS = 24;

/** Progress in [0, 1] through the phase-in; 0 before it starts. */
export function placementRevenuePhaseProgress(
  startTurn: number | undefined | null,
  currentTurn: number | undefined | null
): number {
  if (startTurn == null || currentTurn == null) return 0;
  return Math.max(0, Math.min(1, (currentTurn - startTurn) / PLACEMENT_REVENUE_PHASE_TURNS));
}

/**
 * The factor a seller's sold fraction is multiplied by for one output:
 * 1 before the phase starts, the placed share once it completes.
 */
export function placementRevenueLeg(placement: number | undefined, progress: number): number {
  const p = typeof placement === "number" && Number.isFinite(placement) ? placement : 1;
  const placed = Math.max(0, Math.min(1, p));
  const phase = Math.max(0, Math.min(1, progress));
  return 1 - phase * (1 - placed);
}

/**
 * Start turn of the phase-in for this world: `gameConfig.placementRevenuePhaseStartTurn`
 * as set by an operator. Deliberately NOT stamped automatically on deploy:
 * the revenue removed depends on how much output is genuinely unplaced, which
 * must be measured on the live world before the phase starts. Absent = no phase.
 */
export function placementRevenuePhaseStartTurnFrom(
  config: Pick<GameConfig, "placementRevenuePhaseStartTurn"> | null | undefined
): number | undefined {
  const start = config?.placementRevenuePhaseStartTurn;
  return typeof start === "number" && Number.isFinite(start) ? start : undefined;
}
