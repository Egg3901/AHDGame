import type { Filter } from "mongodb";
import type { Election } from "@/lib/db/types";

/**
 * Mongo filter fragments for election phase boundaries — turn-first with a Date
 * fallback for documents not yet backfilled (retained as a permanent safety
 * net). Resolving phases by turn keeps deadlines from drifting against the
 * wall clock and freezes every countdown while turns are paused.
 *
 * Each helper returns an `{ $or: [...] }` fragment. A query object can hold only
 * one top-level `$or`, so combine multiple fragments with `$and`:
 *
 *   db.collection<Election>("elections").find({
 *     status: { $in: ["active", "upcoming"] },
 *     $and: [primaryClosedFilter(currentTurn, now), electionOpenFilter(currentTurn, now)],
 *   });
 *
 * The fallback clauses are guarded with `primaryEndTurn/endTurn: { $exists: false }`
 * so the turn field always wins when present — a backfilled doc never resolves
 * off its (drift-prone) Date.
 */

/** Primary still open: the primary-close boundary has NOT been reached. */
export function primaryOpenFilter(currentTurn: number, now: Date): Filter<Election> {
  return {
    $or: [
      { primaryEndTurn: { $gt: currentTurn } },
      { primaryEndTurn: { $exists: false }, primaryEndTime: { $gt: now } },
    ],
  };
}

/**
 * Primary closed: the primary-close boundary has been reached. Strict — only
 * matches documents that actually have a primary boundary (mirrors the legacy
 * `primaryEndTime: { $lte: now }`, which never matched primary-less docs).
 */
export function primaryClosedFilter(currentTurn: number, now: Date): Filter<Election> {
  return {
    $or: [
      { primaryEndTurn: { $lte: currentTurn } },
      { primaryEndTurn: { $exists: false }, primaryEndTime: { $lte: now } },
    ],
  };
}

/**
 * General phase: the primary has closed OR there is no primary at all. Mirrors
 * the legacy `$or: [{ primaryEndTime: { $lte: now } }, { primaryEndTime: { $exists: false } }]`
 * used by presidential general-vote accumulation and margin calculations.
 */
export function generalPhaseFilter(currentTurn: number, now: Date): Filter<Election> {
  return {
    $or: [
      { primaryEndTurn: { $lte: currentTurn } },
      { primaryEndTurn: { $exists: false }, primaryEndTime: { $lte: now } },
      { primaryEndTurn: { $exists: false }, primaryEndTime: { $exists: false } },
    ],
  };
}

/**
 * In-memory equivalent of {@link primaryClosedFilter} for an already-loaded
 * election document. Turn-first (drift-immune) with a Date fallback, and — like
 * the Mongo filter — strict: a race with no primary boundary at all is NOT
 * considered "primary closed" (it never had a primary phase to close).
 *
 * Use this to gate "is this race still accepting new filings": once the primary
 * has closed the general phase is underway and no new candidate may enter.
 */
export function isPrimaryClosed(
  election: Pick<Election, "primaryEndTurn" | "primaryEndTime">,
  currentTurn: number,
  now: Date
): boolean {
  if (typeof election.primaryEndTurn === "number") {
    return election.primaryEndTurn <= currentTurn;
  }
  if (election.primaryEndTime) {
    return new Date(election.primaryEndTime) <= now;
  }
  return false;
}

/**
 * In-memory "is this race currently in its primary phase". True only when the
 * election HAS a primary boundary AND that boundary has not yet passed. A race
 * with no primary at all (general-only) is never "in the primary phase" — the
 * opposite of treating an absent boundary as an open primary. Use this to gate
 * primary-only behavior (e.g. intra-party debate pairings) without misfiring on
 * general-only races.
 */
export function isInPrimaryPhase(
  election: Pick<Election, "primaryEndTurn" | "primaryEndTime">,
  currentTurn: number,
  now: Date
): boolean {
  const hasPrimaryBoundary =
    typeof election.primaryEndTurn === "number" || election.primaryEndTime != null;
  return hasPrimaryBoundary && !isPrimaryClosed(election, currentTurn, now);
}

/** Election still open: the general-close boundary has NOT been reached. */
export function electionOpenFilter(currentTurn: number, now: Date): Filter<Election> {
  return {
    $or: [
      { endTurn: { $gt: currentTurn } },
      { endTurn: { $exists: false }, endTime: { $gt: now } },
    ],
  };
}
