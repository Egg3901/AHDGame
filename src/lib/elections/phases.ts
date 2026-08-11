import type { GameTimeContext } from "@/lib/time/gameTime";
import { hasGameTimePassed } from "@/lib/time/gameTime";

export interface ElectionPhase {
  isUpcoming: boolean;
  inPrimary: boolean;
  inGeneral: boolean;
  isEnded: boolean;
}

/** Election whose phase boundaries are read turn-first with a Date fallback. */
export interface ElectionTurnBounds {
  startTurn?: number | null;
  primaryEndTurn?: number | null;
  endTurn?: number | null;
  startTime?: Date | string | null;
  primaryEndTime?: Date | string | null;
  endTime?: Date | string | null;
}

/**
 * Turn-first deadline helpers. Prefer the turn field (drift-immune, freezes on
 * pause); fall back to the Date for docs not yet backfilled. The Date fallback
 * is retained as a permanent safety net for legacy/un-backfilled docs. Absent
 * both → sensible default matching the legacy computeElectionPhase semantics.
 */
export function hasElectionStarted(
  el: Pick<ElectionTurnBounds, "startTurn" | "startTime">,
  currentTurn: number,
  gameTime: GameTimeContext
): boolean {
  if (typeof el.startTurn === "number") return currentTurn >= el.startTurn;
  return el.startTime ? hasGameTimePassed(el.startTime, gameTime) : true;
}

export function isPrimaryEnded(
  el: Pick<ElectionTurnBounds, "primaryEndTurn" | "primaryEndTime">,
  currentTurn: number,
  gameTime: GameTimeContext
): boolean {
  if (typeof el.primaryEndTurn === "number") return currentTurn >= el.primaryEndTurn;
  return el.primaryEndTime ? hasGameTimePassed(el.primaryEndTime, gameTime) : true;
}

export function isElectionEnded(
  el: Pick<ElectionTurnBounds, "endTurn" | "endTime">,
  currentTurn: number,
  gameTime: GameTimeContext
): boolean {
  if (typeof el.endTurn === "number") return currentTurn >= el.endTurn;
  return el.endTime ? hasGameTimePassed(el.endTime, gameTime) : false;
}

/**
 * True when a race is in its general-election phase for campaign-upgrade
 * pricing: it has both a primary boundary and an end boundary, the primary has
 * closed, and the election has not yet ended. Turn-first (drift-immune) with a
 * Date fallback via `isPrimaryEnded` / `isElectionEnded`.
 *
 * SSOT for the general-phase upgrade surcharge — the upgrade gate and every
 * cost-preview surface call this so the displayed cost matches the charged cost.
 */
export function isCampaignUpgradeGeneralPhase(
  election:
    | Pick<ElectionTurnBounds, "primaryEndTurn" | "primaryEndTime" | "endTurn" | "endTime">
    | null
    | undefined,
  currentTurn: number,
  gameTime: GameTimeContext
): boolean {
  if (!election) return false;
  const hasPrimaryBound = election.primaryEndTurn != null || election.primaryEndTime != null;
  const hasEndBound = election.endTurn != null || election.endTime != null;
  if (!hasPrimaryBound || !hasEndBound) return false;
  return (
    isPrimaryEnded(election, currentTurn, gameTime) &&
    !isElectionEnded(election, currentTurn, gameTime)
  );
}

export function computeElectionPhase(
  startTime: Date | string | null,
  primaryEndTime: Date | string | null,
  endTime: Date | string | null,
  status: string,
  gameTime: GameTimeContext,
  // Turn-first bounds. When a turn field is a number it wins over the Date;
  // when absent, the legacy Date/status logic is preserved exactly.
  turnFields?: {
    startTurn?: number | null;
    primaryEndTurn?: number | null;
    endTurn?: number | null;
  }
): ElectionPhase {
  const ct = gameTime.currentTurn;
  const startTurn = turnFields?.startTurn;
  const primaryEndTurn = turnFields?.primaryEndTurn;
  const endTurn = turnFields?.endTurn;

  // Upcoming: before start
  const isUpcoming =
    typeof startTurn === "number"
      ? ct < startTurn
      : startTime
        ? !hasGameTimePassed(startTime, gameTime)
        : status === "upcoming";

  // Ended: after end
  const isEnded =
    typeof endTurn === "number"
      ? ct >= endTurn
      : endTime
        ? hasGameTimePassed(endTime, gameTime)
        : status === "completed";

  // Primary: between start and primaryEnd (when a primary bound exists)
  const hasPrimaryBound = typeof primaryEndTurn === "number" || !!primaryEndTime;
  const primaryStillOpen =
    typeof primaryEndTurn === "number"
      ? ct < primaryEndTurn
      : primaryEndTime
        ? !hasGameTimePassed(primaryEndTime, gameTime)
        : false;
  const inPrimary = !isUpcoming && !isEnded && hasPrimaryBound ? primaryStillOpen : false;

  // General: after primary but before end
  const inGeneral = !isUpcoming && !isEnded && !inPrimary;

  return { isUpcoming, inPrimary, inGeneral, isEnded };
}
