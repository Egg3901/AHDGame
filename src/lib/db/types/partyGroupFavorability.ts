import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Time-bounded favorability boost between a political party and a specific
 * voter group. Produced by State of the State / National Address deliveries
 * that target a demographic group — the leader's party gets a per-group
 * appeal lift for the address's window.
 *
 * Read by the election vote-distribution engine, which multiplies the
 * group-level weight by (1 + favorabilityDelta / 100) when a candidate's
 * party matches an active row's partyId + groupId.
 *
 * Collection: "partyGroupFavorability"
 */
export interface PartyGroupFavorability {
  _id?: ObjectId;
  countryId: CountryId;
  /** Political-party sequentialId (stringified) of the favored party. */
  partyId: string;
  /** Voter-group id (e.g. "evangelicals", "college_liberals"). */
  groupId: string;
  /** Additive favorability points applied while active. Positive = bonus. */
  favorabilityDelta: number;
  /** Source address (audit + correlation). */
  sourceAddressId: ObjectId;
  /** Turn at which this boost stops applying (inclusive). Read-side filter
   *  uses `expiresAtTurn > currentTurn`. */
  expiresAtTurn: number;
  expired?: boolean;
  createdAt: Date;
}
