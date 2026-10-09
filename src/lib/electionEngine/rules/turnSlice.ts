/**
 * Half-hour split turns. The results tick at :30 banks the "early" half of the
 * coming turn's vote slice; the turn itself banks the "rest". A turn counted in
 * one go has no part. Every vote engine shares this decision so that early plus
 * rest is exactly one whole slice and no half is ever counted twice.
 */
export type TurnSlicePart = "early" | "rest";

/** Share of a turn's slice each half carries. */
export const HALF_TURN_SLICE_FRACTION = 0.5;

export interface TurnSlicePlan {
  /** Absent: the whole turn in one write. */
  slicePart?: TurnSlicePart;
  /** Multiplier on the turn's vote pool. */
  fraction: number;
}

/**
 * Decide what this call may bank for a turn, given the parts already recorded
 * for that same turn (`undefined` marks a whole-turn record). Returns null when
 * there is nothing left to count:
 * - an early tick when anything for the turn exists (second early, or the turn
 *   already ran);
 * - the turn when a whole or rest record exists.
 * Otherwise the turn banks the rest after an early half, or the whole turn.
 */
export function planTurnSlice(
  sameTurnParts: readonly (TurnSlicePart | undefined)[],
  slice?: "early"
): TurnSlicePlan | null {
  if (slice === "early") {
    return sameTurnParts.length > 0
      ? null
      : { slicePart: "early", fraction: HALF_TURN_SLICE_FRACTION };
  }
  if (sameTurnParts.some((part) => part !== "early")) return null;
  return sameTurnParts.length > 0
    ? { slicePart: "rest", fraction: HALF_TURN_SLICE_FRACTION }
    : { fraction: 1 };
}

/** Parts already recorded for `turn` in a list of per-turn snapshots. */
export function sameTurnSliceParts(
  snapshots: readonly { turn?: number; slicePart?: TurnSlicePart }[] | undefined,
  turn: number
): (TurnSlicePart | undefined)[] {
  return (snapshots ?? []).filter((s) => s.turn === turn).map((s) => s.slicePart);
}

/**
 * True once a general tally has banked at least one general turn. The early
 * tick only extends a race already counting; a tally that so far holds only
 * primary ballots (or a fresh presidential re-init) still has its primary to
 * resolve on the turn, which may reset the tally or stamp primary results.
 * Engines without per-turn snapshots record `lastAccruedTurn` instead.
 */
export function hasBankedGeneralTurn(
  tally: { turnSnapshots?: readonly unknown[]; lastAccruedTurn?: number } | null | undefined
): boolean {
  return (tally?.turnSnapshots?.length ?? 0) > 0 || typeof tally?.lastAccruedTurn === "number";
}

/**
 * Collapse a per-turn history in which a split turn holds an early and a rest
 * row into one row per turn. Rows carry cumulative values, so the rest row
 * already includes the early half and replaces it; an early row stands alone
 * until its turn banks the rest. Order is preserved, rows without a turn are
 * kept.
 */
export function oneRowPerTurn<T extends { turn?: number; slicePart?: TurnSlicePart }>(
  rows: readonly T[]
): T[] {
  const completed = new Set(rows.filter((row) => row.slicePart !== "early").map((row) => row.turn));
  return rows.filter(
    (row) => row.slicePart !== "early" || typeof row.turn !== "number" || !completed.has(row.turn)
  );
}
