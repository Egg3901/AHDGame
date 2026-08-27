import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PeaceTerm } from "@/lib/military/peaceTerm";

/**
 * Turns a truce holds between two countries after ANY war between them ends —
 * negotiated or won outright.
 *
 * Not a negotiated term: neither party can trade it away. It stops a country that
 * has just been beaten being re-declared on the moment the attacker's 120-turn
 * declaration cooldown lapses, at the point it is least able to resist.
 */
export const TRUCE_TURNS = 240;

/**
 * Turns a peace offer stands before it lapses. Fixed rather than player-chosen: one
 * less thing to explain, and a duration nobody picks cannot be picked badly.
 */
export const PEACE_OFFER_DURATION_TURNS = 72;

/**
 * A bilateral offer to end one country's participation in one war.
 *
 * Struck between two COUNTRIES, not two sides: the leaver drops off its side's
 * roster and the war continues for everyone else. That follows the consent rule
 * already shipped for coalition offensives — no player commits another player's
 * army — and avoids whole-side peace's failure mode, where one inactive country on a
 * roster could never consent and would freeze the war permanently.
 *
 * Spec: docs/superpowers/specs/2026-08-04-suing-for-peace-design.md
 */
export interface PeaceOfferDoc {
  _id: ObjectId;
  /** The war being exited (ConflictDoc._id). */
  conflictId: string;
  fromCountry: CountryId;
  toCountry: CountryId;
  /**
   * What this settlement takes. Exactly ONE term, enforced by the union rather
   * than by the UI: a discriminated union makes a deal carrying two terms
   * unrepresentable, so it cannot be stored or hand-rolled over the API.
   *
   * Replaced the old `indemnity` field. An indemnity is now one branch of the
   * union, and `amount: 0` is still a clean white peace, the same mechanism
   * dialled to nothing rather than a separate code path. Its `payer` stays
   * explicit because EITHER party may pay: a losing country buys its way out, and
   * a winning country may pay to disengage from a war it no longer wants. That
   * amount is ALWAYS quoted in the payer's local currency, since every
   * treasuryBalance is denominated locally.
   */
  term: PeaceTerm;
  /** Optional note, moderated. Public on the conflict record once accepted. */
  justification?: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "expired";
  offeredTurn: number;
  /** Always `offeredTurn + PEACE_OFFER_DURATION_TURNS`; not player-set. */
  expiresTurn: number;
  /** characterId of whoever made the offer. */
  offeredBy: string;
  /** characterId of whoever accepted or rejected it. */
  resolvedBy?: string;
  resolvedTurn?: number;
}
