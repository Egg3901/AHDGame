/**
 * Client-safe rules for buying +1 office action with main AP.
 *
 * A character may spend `OFFICE_POOL_TOP_UP_AP_COST` main action points to add
 * one action to an office pool they hold (ministerial, vice-president,
 * Justice, gubernatorial), at most once per pool per turn and never above that
 * pool's cap. No server imports here so the office pages can share the copy
 * and the gating with the API. The atomic write lives in `./officePoolTopUp`.
 */

/** Main AP spent to buy one office action. */
export const OFFICE_POOL_TOP_UP_AP_COST = 10;

export type OfficePoolKind = "ministerial" | "vp" | "justice" | "gubernatorial";

export interface OfficePoolTopUpInput {
  remaining: number;
  cap: number;
  /** Turn the pool was last topped up, or null/undefined when never. */
  lastTopUpTurn: number | null | undefined;
  currentTurn: number;
  playerActions: number;
}

export interface OfficePoolTopUpBlock {
  status: 400;
  reason: "full" | "already_this_turn" | "insufficient_ap";
  error: string;
}

/**
 * Why a top-up is not allowed right now, or null when it is. Checked in the
 * order a player can act on it: a full pool first (nothing to buy), then the
 * once-per-turn limit, then the AP balance.
 */
export function officePoolTopUpBlock(input: OfficePoolTopUpInput): OfficePoolTopUpBlock | null {
  if (input.remaining >= input.cap) {
    return { status: 400, reason: "full", error: "This action pool is already full." };
  }
  if (input.lastTopUpTurn != null && input.lastTopUpTurn === input.currentTurn) {
    return {
      status: 400,
      reason: "already_this_turn",
      error: "You already bought an action for this office this turn.",
    };
  }
  if (input.playerActions < OFFICE_POOL_TOP_UP_AP_COST) {
    return {
      status: 400,
      reason: "insufficient_ap",
      error: `Buying an office action costs ${OFFICE_POOL_TOP_UP_AP_COST} AP (you have ${Math.floor(
        input.playerActions
      )}).`,
    };
  }
  return null;
}

/** Top-up state a GET route hands the office page for the holder's button. */
export interface OfficePoolTopUpStatus {
  cost: number;
  playerActions: number;
  usedThisTurn: boolean;
}

export function officePoolTopUpStatus(
  lastTopUpTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  playerActions: number | null | undefined
): OfficePoolTopUpStatus {
  return {
    cost: OFFICE_POOL_TOP_UP_AP_COST,
    playerActions: playerActions ?? 0,
    usedThisTurn: lastTopUpTurn != null && currentTurn != null && lastTopUpTurn === currentTurn,
  };
}
