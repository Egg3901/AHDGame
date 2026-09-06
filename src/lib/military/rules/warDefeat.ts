import type { CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { ConflictDoc } from "@/lib/db/types/conflict";

/** A major strategic defeat remains politically visible for three in-game years. */
export const WAR_DEFEAT_WINDOW_TURNS = 3 * TURNS_PER_YEAR;
export const WAR_DEFEAT_PENALTY = -5;
export const WAR_DEFEAT_PENALTY_CAP = -10;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Return the current country's share of a resolved defeat, or zero. */
export function resolvedWarDefeatEffect(
  conflict: ConflictDoc,
  countryId: CountryId,
  turn: number
): number {
  if (conflict.status !== "resolved") return 0;
  if (!Number.isFinite(turn) || !Number.isInteger(turn)) return 0;
  const endTurn = conflict.endTurn;
  const winner = conflict.outcome?.winner;
  if (!Number.isFinite(endTurn) || !Number.isInteger(endTurn)) return 0;
  if (winner !== "A" && winner !== "B" && winner !== "stalemate") return 0;
  const side = conflict.sideA.countries.includes(countryId)
    ? "A"
    : conflict.sideB.countries.includes(countryId)
      ? "B"
      : null;
  if (endTurn > turn || turn - endTurn >= WAR_DEFEAT_WINDOW_TURNS) return 0;
  if (!winner || winner === "stalemate" || side === null || side === winner) return 0;
  return round1(WAR_DEFEAT_PENALTY * (1 - (turn - endTurn) / WAR_DEFEAT_WINDOW_TURNS));
}
