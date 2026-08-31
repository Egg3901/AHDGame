import type { IntelligenceAgency } from "@/lib/db/types/intelligence";
import { OP_SLOTS_PER_TURN } from "./config";

/**
 * Slots left this turn.
 *
 * Refreshed LAZILY: any read for a turn newer than the stored one treats the
 * budget as full, so no global turn-loop hook is needed. This is the pattern
 * `DiplomaticActionBudget` documents, copied deliberately.
 */
export function slotsRemaining(agency: IntelligenceAgency, turn: number): number {
  const slots = agency.opSlots;
  if (!slots || slots.turn !== turn) return OP_SLOTS_PER_TURN;
  if (!Number.isFinite(slots.remaining)) return 0;
  return Math.max(0, Math.min(OP_SLOTS_PER_TURN, slots.remaining));
}

/**
 * Spend one slot, returning the value to persist, or null when the budget is
 * exhausted. The caller decides how to report the refusal.
 */
export function spendSlot(
  agency: IntelligenceAgency,
  turn: number
): { turn: number; remaining: number } | null {
  const remaining = slotsRemaining(agency, turn);
  if (remaining <= 0) return null;
  return { turn, remaining: remaining - 1 };
}
