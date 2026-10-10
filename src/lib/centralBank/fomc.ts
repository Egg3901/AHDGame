// src/lib/centralBank/fomc.ts
/**
 * Pure FOMC committee logic. No DB, no clock — deterministic and unit-testable.
 *
 * Each governor seat has a hawk/dove alignment. A seat's *preferred* move is the
 * sign of the Taylor-rule step it would take on its own (the same rule the
 * autonomous single chair uses in `nppChairAutoRate.ts`, tilted by alignment).
 * The chair proposes a motion; every seat's ballot is a direction (hike/cut/hold)
 * and it "agrees" with the motion when the directions match.
 *
 * A motion passes on a strict majority of the seated governors. Vacant seats do
 * not count; a seated governor without a ballot abstains. NPP seats auto-vote
 * their preference the moment a meeting opens; player seats vote live or fall
 * back to abstain at resolution.
 */

import {
  computeNppChairRateTarget,
  computeNppChairRateStep,
} from "@/lib/nppAutonomy/nppChairAutoRate";
import type { ChairAlignment } from "@/lib/centralBank/chairAlignment";
import type { FomcVote, FomcBallot, FomcSeat } from "@/lib/db/types/centralBank";

/** Below this absolute rate step (pp) a seat prefers to hold rather than move. */
export const FOMC_MOVE_THRESHOLD = 0.125;

/** Macro inputs shared by every seat when it forms a view for one meeting. */
export interface FomcMacroContext {
  neutralRate: number;
  inflationRate: number;
  targetInflation: number;
  gdpGrowth: number;
  currentRate: number;
}

/**
 * The signed rate step (pp) a seat of the given alignment would take on its own.
 * Positive ⇒ wants to hike, negative ⇒ wants to cut.
 */
export function seatDesiredStep(alignment: ChairAlignment, ctx: FomcMacroContext): number {
  const target = computeNppChairRateTarget({
    neutralRate: ctx.neutralRate,
    inflationRate: ctx.inflationRate,
    targetInflation: ctx.targetInflation,
    gdpGrowth: ctx.gdpGrowth,
    alignment,
  });
  return computeNppChairRateStep({
    currentRate: ctx.currentRate,
    targetRate: target,
    alignment,
    inflationGap: ctx.inflationRate - ctx.targetInflation,
  });
}

/** Direction implied by a signed step, applying the hold deadband. */
export function directionFromStep(step: number): FomcVote {
  if (step > FOMC_MOVE_THRESHOLD) return "hike";
  if (step < -FOMC_MOVE_THRESHOLD) return "cut";
  return "hold";
}

/** The move a seat would cast for on its own. */
export function seatPreferredVote(alignment: ChairAlignment, ctx: FomcMacroContext): FomcVote {
  return directionFromStep(seatDesiredStep(alignment, ctx));
}

/**
 * The chair's motion for a meeting. When `canChangeRate` is false (per-term cap
 * hit, cooldown active, or command economy) the chair can only table a hold.
 * `proposedDelta` is the signed pp applied to primeRate if the motion passes.
 */
export function proposeChairMotion(
  chairAlignment: ChairAlignment,
  ctx: FomcMacroContext,
  opts: { canChangeRate: boolean }
): { motion: FomcVote; proposedDelta: number } {
  const step = seatDesiredStep(chairAlignment, ctx);
  const dir = directionFromStep(step);
  if (!opts.canChangeRate || dir === "hold") return { motion: "hold", proposedDelta: 0 };
  return { motion: dir, proposedDelta: step };
}

/** A ballot agrees with the motion when it points the same direction. */
export function ballotAgrees(ballot: FomcVote, motion: FomcVote): boolean {
  return ballot === motion;
}

/** Count the governors occupying seats; vacancies do not count toward motions. */
export function seatedCount(board: readonly Pick<FomcSeat, "occupantType">[]): number {
  return board.filter((seat) => seat.occupantType !== "vacant").length;
}

/** Strict majority of the seated governors. */
export function majorityThreshold(seatedGovernorCount: number): number {
  return Math.floor(seatedGovernorCount / 2) + 1;
}

/**
 * Whether the committee can actually carry a motion right now.
 *
 * Any seated governor can carry a motion by voting for it. Only a board with no
 * seated governors is dead; in that case the chair sets the rate directly.
 */
export function boardCanCarryMotions(board: readonly FomcSeat[]): boolean {
  return seatedCount(board) > 0;
}

/**
 * Ballots that still belong to a seated governor. A seat that went vacant
 * mid-meeting (term expiry, removal) can leave its auto ballot behind; that
 * ballot must not count, or the tally shows more votes than there are members
 * (ticket #1463).
 */
export function seatedBallots<B extends { seatId: string }>(
  ballots: readonly B[],
  board: readonly { seatId: string; occupantType: string }[]
): B[] {
  const seated = new Set(board.filter((s) => s.occupantType !== "vacant").map((s) => s.seatId));
  const seen = new Set<string>();
  return ballots.filter((b) => {
    if (!seated.has(b.seatId) || seen.has(b.seatId)) return false;
    seen.add(b.seatId);
    return true;
  });
}

export interface FomcTally {
  agree: number;
  disagree: number;
  /** Seated governors without a ballot (no-shows). */
  abstain: number;
  /** Votes needed to pass (majority of seated governors). */
  needed: number;
  /** True once the outcome can no longer change: passed, or can't reach a majority. */
  decided: boolean;
  passed: boolean;
}

/**
 * Tally a motion against the ballots cast by seated governors. Seated members
 * without a ballot abstain; vacant seats are excluded. `decided` reports early
 * resolution: the motion has passed, or enough abstentions/disagreements make a
 * majority impossible even if all remaining seated members agreed. A decided
 * meeting can resolve despite pending player ballots, but consumers must
 * preserve the opening turn before resolving it (see `resolveMeetingInto`).
 */
export function tallyMeeting(
  ballots: FomcBallot[],
  motion: FomcVote,
  seatedGovernorCount: number
): FomcTally {
  const cast = ballots.length;
  let agree = 0;
  for (const b of ballots) if (ballotAgrees(b.vote, motion)) agree++;
  const disagree = cast - agree;
  const abstain = Math.max(0, seatedGovernorCount - cast);
  const needed = majorityThreshold(seatedGovernorCount);
  const passed = agree >= needed;
  const maxPossibleAgree = agree + abstain; // if every remaining seat agreed
  const decided = passed || maxPossibleAgree < needed;
  return { agree, disagree, abstain, needed, decided, passed };
}

/** NPP governors vote automatically; player governors vote live. */
export function isAutoSeat(seat: FomcSeat): boolean {
  return seat.occupantType === "npp";
}

/** Seats a live player controls and must be prompted to vote. */
export function playerSeats(board: FomcSeat[]): FomcSeat[] {
  return board.filter((s) => s.occupantType === "player");
}
