import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Chair-set National Agenda for a party. Surfaces in 4 places:
 * - National Party Hub
 * - State Party Hub
 * - State Politics tab
 * - Down-Ballot / tier-selector context (Primary + General screens)
 *
 * Decision (plan D4): one active agenda per party at a time. Setting a new
 * one supersedes the old; history is preserved via `expiresAtTurn`.
 *
 * See plan §"Phase 3 — Files Touched / Schema" + D4.
 */
export interface PartyAgenda {
  _id: ObjectId;
  countryId: CountryId;
  partyId: string;
  /** Session / cycle key. Lets a fresh game iteration start with no inherited agendas. */
  iterationId: string;
  headline: string;
  detail: string;
  /** ObjectId of the chair who set the agenda — non-chair POSTs to the route 403. */
  setBy: ObjectId;
  setAtTurn: number;
  /**
   * If unset, the agenda is active indefinitely. Setting a new agenda for
   * the same `(countryId, partyId, iterationId)` writes the old one's
   * `expiresAtTurn` to the new agenda's `setAtTurn`.
   */
  expiresAtTurn?: number;
}
