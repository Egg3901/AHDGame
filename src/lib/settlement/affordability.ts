/**
 * Can this actor pay for this play?
 *
 * Pure, and shared by the commit route (which refuses) and the read model
 * (which greys the button out), so the reason a play is unavailable is computed
 * once. A single ordered `reason` rather than a set — the card shows one line.
 */
import type { SettlementSeatState } from "@/lib/db/types/settlementCrisis";
import {
  getSeat,
  type SettlementPlayDef,
  type SettlementSeatKey,
} from "@/lib/constants/settlementCrisis";

export interface SeatBudget {
  actionsPerTurn: number;
  actionsRemaining: number;
  capital: number;
}

/**
 * Why a play is unavailable. Only reasons something actually produces belong
 * here — Phase 3's commit route widens this when it starts rejecting unknown
 * play ids, rather than the union carrying a member nobody emits.
 */
export type AffordabilityReason = "actions" | "capital" | "funds" | "no-direction";

export interface Affordability {
  ok: boolean;
  reason?: AffordabilityReason;
}

/** What a seat has left this turn. */
export function seatBudgetFor(state: SettlementSeatState, seatId: SettlementSeatKey): SeatBudget {
  const actionsPerTurn = getSeat(seatId)?.actionsPerTurn ?? 0;
  return {
    actionsPerTurn,
    actionsRemaining: Math.max(0, actionsPerTurn - state.actionsUsedTurn),
    capital: state.capital,
  };
}

/**
 * Reasons are checked in a fixed order — actions, then capital, then funds — so
 * a play short on two counts always names the same one and the UI copy does not
 * flicker between renders.
 */
export function canSeatAfford(
  play: SettlementPlayDef,
  budget: SeatBudget,
  availableFunds: number
): Affordability {
  if (play.actionCost > budget.actionsRemaining) return { ok: false, reason: "actions" };
  if (play.capitalCost > budget.capital) return { ok: false, reason: "capital" };
  if (play.fundsCost > availableFunds) return { ok: false, reason: "funds" };
  return { ok: true };
}

/**
 * The personal tier. Costs the character's own `actions` and personal funds;
 * capital is deliberately not consulted, because no personal play has a capital
 * cost and inventing a personal capital pool for one would be a resource that
 * exists for nothing.
 */
export function canCharacterAfford(
  play: SettlementPlayDef,
  actionsRemaining: number,
  availableFunds: number
): Affordability {
  if (play.actionCost > actionsRemaining) return { ok: false, reason: "actions" };
  if (play.fundsCost > availableFunds) return { ok: false, reason: "funds" };
  return { ok: true };
}
