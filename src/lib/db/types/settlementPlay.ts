import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SettlementInstitutionId, SettlementSeatId } from "./settlementCrisis";

/** Whether a play was made for the nation or by the character personally. */
export type SettlementActor = "seat" | "personal";

/**
 * Which budget paid for a play. Personal plays are always `"funds"` — a
 * character has no seat capital pool to draw on.
 */
export type SettlementPaymentMode = "funds" | "capital";

export type SettlementPlayClass =
  "exclusive" | "diplomatic" | "spend" | "coercive" | "forces" | "personal";

/**
 * One committed play, queued on commit and consumed by the settlement turn
 * phase.
 *
 * Resolved rows are STAMPED (`resolvedTurn`, `appliedPoints`) rather than
 * deleted, mirroring `AlignmentPlay` — a player has to be able to see what
 * their money bought. That is the difference between a lever and a slot machine.
 */
export interface SettlementPlayDoc {
  _id: ObjectId;
  crisisId: ObjectId;
  actor: SettlementActor;
  /** Null when `actor === "personal"`. */
  seatId: SettlementSeatId | null;
  /** Who actually pressed it. Always set, including for seat plays. */
  characterId: ObjectId;
  countryId: CountryId | null;
  playId: string;
  /** Null targets the settlement itself rather than one institution. */
  targetInstitutionId: SettlementInstitutionId | null;
  /** Resolved at commit: live bloc for seats, player choice for personal. */
  direction: 1 | -1;
  class: SettlementPlayClass;
  costs: { funds: number; capital: number; actions: number };
  /** Catalogue magnitude in hundredths, always UNSIGNED. */
  basePoints: number;
  /** Signed hundredths after the multiplier. Null while pending. */
  appliedPoints: number | null;
  heatAdded: number;
  turn: number;
  resolvedTurn: number | null;
  createdAt: Date;
}
