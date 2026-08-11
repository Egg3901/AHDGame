import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WhippedFromVoteMap } from "./legislation";

export type ImpeachmentStage =
  | "house" // articles filed, lower chamber voting to impeach
  | "senate" // impeached, upper chamber voting to convict
  | "convicted" // 2/3 upper chamber — target removed
  | "acquitted" // upper chamber failed to convict
  | "dismissed" // lower chamber failed to impeach
  | "cancelled"; // target already left office / auto-cancelled

export type ImpeachmentVoteValue = "aye" | "nay" | "abstain";

/**
 * A two-chamber presidential impeachment. Modeled on {@link NoConfidenceVote}
 * but with a sequential House (impeach — simple majority) → Senate (convict —
 * seat-weighted two-thirds) state machine. On conviction the target executive
 * seat is vacated and the existing `presidentialSuccession` turn phase promotes
 * the VP. Presidential systems only (parliamentary countries use no-confidence).
 */
export interface Impeachment {
  _id: ObjectId;
  countryId: CountryId;

  // Target — the sitting executive being impeached (player character).
  targetCharacterId: ObjectId;
  targetName: string;
  targetOffice: string; // executive office key: "president" (national) | "governor" (state)
  /** Set for state-scoped offices (governor): the state whose legislature tries the case. */
  state?: string;

  // Filer — a sitting lower-chamber member.
  filedByCharacterId: ObjectId;
  filedByName: string;

  // Stage machine
  stage: ImpeachmentStage;

  // House vote (impeachment). Votes keyed by characterId or `npp_<id>`.
  houseVotesFor: number;
  houseVotesAgainst: number;
  houseVotesAbstain: number;
  houseVotes: Record<string, ImpeachmentVoteValue>;
  houseVotingEndsOnTurn: number;

  // Senate vote (conviction). Null timing until the House impeaches.
  senateVotesFor: number;
  senateVotesAgainst: number;
  senateVotesAbstain: number;
  senateVotes: Record<string, ImpeachmentVoteValue>;
  senateVotingEndsOnTurn: number | null;

  whippedFromVote?: WhippedFromVoteMap;

  // Cooldown anchor + lifecycle
  turnFiled: number;
  resolvedOnTurn?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const IMPEACHMENTS_COLLECTION = "impeachments";
