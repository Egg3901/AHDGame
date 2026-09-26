import type { BankCharterType } from "@/lib/db/types/bank";
import type { Party } from "../types";

export function charterLabel(type: BankCharterType): string {
  if (type === "retail") return "Retail";
  if (type === "investment") return "Investment";
  return "Universal";
}

/**
 * Reducer body for panel state that moves as one group. Every panel dispatches
 * a partial patch instead of juggling a setter per field.
 */
export function mergeState<State>(state: State, patch: Partial<State>): State {
  return { ...state, ...patch };
}

/** Link to a party's public page, by sequentialId when it has one. */
export function partyHref(kind: "character" | "corporation", party: Party): string {
  const seg = party.sequentialId ?? party.id;
  return kind === "character" ? `/character/${seg}` : `/corporation/${seg}`;
}

/**
 * Turns run hourly on the live loop, so every "N turns" at a decision point
 * reads with its clock time: "12 turns (about 12 hours)".
 */
export function turnsToHours(turns: number): string {
  const n = Math.max(0, Math.round(turns));
  return `${n} turn${n === 1 ? "" : "s"} (about ${n} hour${n === 1 ? "" : "s"})`;
}
