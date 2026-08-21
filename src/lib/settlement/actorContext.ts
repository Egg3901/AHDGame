/**
 * Everything the commit route and the dossier need to know about one viewer:
 * which delegation they may act for, which way it pushes, what both budgets
 * hold.
 *
 * Assembled in one place so the route that REFUSES a play and the card that
 * greys its button out cannot disagree about why.
 *
 * A seat holder gets BOTH a seat context and a personal one. The budgets are
 * independent by design — a Chancellor may spend the nation's credibility and
 * then sign the open letter against his own government's line, and the game
 * should let that story happen.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character, GameState } from "@/lib/db/types";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import type { SettlementSeatKey } from "@/lib/constants/settlementCrisis";
import { isSettlementCrisisEnabled } from "./featureFlag";
import { resolveSettlementSeat, type SettlementSeatRole } from "./seatResolution";
import { resolveSeatDirection, type SettlementDirection } from "./direction";
import { seatBudgetFor, type AffordabilityReason, type SeatBudget } from "./affordability";

export interface SettlementSeatContext {
  id: SettlementSeatKey;
  role: SettlementSeatRole;
  /** Null when the seat's country belongs to neither bloc. */
  direction: SettlementDirection | null;
  budget: SeatBudget;
  canAct: boolean;
  blockedReason: AffordabilityReason | null;
}

export interface SettlementActorContext {
  /** Null when no crisis is open. Distinct from the function returning null. */
  crisisId: string | null;
  seat: SettlementSeatContext | null;
  personal: { actionsRemaining: number };
}

/**
 * THREE OUTCOMES, and callers must tell them apart:
 *   - `null`                       — the feature gate is off; render nothing.
 *   - `{ crisisId: null, … }`      — gate on, but no crisis is open.
 *   - `{ crisisId: "…", … }`       — a live crisis this viewer can look at.
 *
 * Collapsing the first two would make a disabled feature and a quiet world
 * look identical to the dossier.
 */
export async function loadSettlementActorContext(
  db: Db,
  characterId: ObjectId
): Promise<SettlementActorContext | null> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { settlementCrisisEnabled: 1 } });
  if (!(await isSettlementCrisisEnabled(gameState ?? {}))) return null;

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { actions: 1 } });
  const personal = { actionsRemaining: character?.actions ?? 0 };

  const crises = await getSettlementCrisesCollection(db);
  // No cast: the collection is already typed, and a redundant `as` here would
  // hide a real shape change behind a silent assertion later.
  const crisis = await crises.findOne({ status: "open" });
  if (!crisis) return { crisisId: null, seat: null, personal };

  const claim = await resolveSettlementSeat(db, characterId);
  if (!claim) return { crisisId: crisis._id.toString(), seat: null, personal };

  const state = crisis.seats.find((s) => s.id === claim.seatId);
  const budget = state
    ? seatBudgetFor(state, claim.seatId)
    : { actionsPerTurn: 0, actionsRemaining: 0, actionsBankCap: 0, capital: 0 };

  const direction = await resolveSeatDirection(db, claim.seatId);

  // Ordered like `canSeatAfford`: the structural block first, then the budget
  // one, so a seat that is both non-aligned and out of actions always reports
  // the reason that actually matters.
  const blockedReason: AffordabilityReason | null =
    direction === null ? "no-direction" : budget.actionsRemaining <= 0 ? "actions" : null;

  return {
    crisisId: crisis._id.toString(),
    seat: {
      id: claim.seatId,
      role: claim.role,
      direction,
      budget,
      canAct: blockedReason === null,
      blockedReason,
    },
    personal,
  };
}
