import type { ObjectId } from "mongodb";

/**
 * A settlement crisis: a standing contest over one nation's constitutional
 * settlement, fought across several weighted institutions rather than on a
 * single meter.
 *
 * POSITIONS ARE INTEGER HUNDREDTHS, 0-10000. Same reasoning as
 * `src/lib/alignment/normalize.ts`: the index is a weighted mean of the
 * institutions, and on a float grid that mean drifts away from the cards it is
 * derived from. Integers make it exact; the division to points happens once, at
 * render.
 */
export type SettlementInstitutionId = "bundestag" | "laender" | "street" | "garrison";
export type SettlementSeatId = "US" | "UK" | "RU" | "DD";
export type SettlementStatus = "open" | "frozen" | "resolved";
export type SettlementOutcome = "incumbent" | "challenger";

export interface SettlementInstitutionState {
  id: SettlementInstitutionId;
  /** Relative pull on the index. Weights across all institutions sum to 10. */
  weight: number;
  /** Hundredths toward the challenger, 0-10000. */
  position: number;
  lastPlay: { seatId: SettlementSeatId | null; label: string; turn: number } | null;
  /** This tick's drift roll in hundredths, signed. */
  lastDrift: number;
}

export interface SettlementSeatState {
  id: SettlementSeatId;
  /** Banked capital, whole points, 0..SEAT_CAPITAL_CAP. */
  capital: number;
  /** Seat action points spent this turn; reset by the turn phase. */
  actionsUsedTurn: number;
  lastActedTurn: number | null;
  /** Cumulative |appliedPoints| in hundredths — the delegation bench figure. */
  committedPoints: number;
}

export interface SettlementCrisisDoc {
  _id: ObjectId;
  kind: "settlement.germanQuestion";
  status: SettlementStatus;
  /** Whose settlement is at stake. Unplayable; acts only through drift. */
  targetEntityId: string;
  /** Who absorbs the target on a challenger win. */
  challengerEntityId: string;
  /**
   * DERIVED — the weight-normalised mean of `institutions[].position`, in
   * hundredths. Never written directly; `recomputePosition` owns it.
   */
  position: number;
  institutions: SettlementInstitutionState[];
  seats: SettlementSeatState[];
  ladder: { heat: number; armedTurn: number | null };
  /** Weighted drift applied per tick, newest first, capped at 6 entries. */
  driftHistory: number[];
  /**
   * Last turn the settlement phase ticked this crisis.
   *
   * The phase claims on this before doing anything, so two overlapping turn
   * runs — which this project has had, from rolling deploys — cannot both tick
   * it. Without the claim the loser computes a drift-only result from the same
   * snapshot and overwrites the winner's write, silently discarding every play
   * that landed that turn.
   */
  lastTickedTurn: number | null;
  /** Set when a declared war freezes the crisis. */
  conflictId: string | null;
  openedTurn: number;
  resolvedTurn: number | null;
  outcome: SettlementOutcome | null;
  cooldownUntilTurn: number | null;
  createdAt: Date;
  updatedAt: Date;
}
