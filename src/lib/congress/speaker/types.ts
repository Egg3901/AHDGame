/** Speaker API response types. Re-exported from route for frontend. */

import type { VoteByParty } from "@/lib/congress/governmentVoteBreakdown";

export interface SpeakerDisplay {
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  party: string;
  partyName: string;
  partyColor: string;
  state?: string;
  electedAt: string | null;
  isNPP: boolean;
}

export interface CandidacyDisplay {
  id: string;
  nomineeId: string;
  /** Sequential ID for stable URLs (prefer this over nomineeId) */
  nomineeSequentialId: number | null;
  nomineeName: string;
  nomineeParty: string;
  nomineePartyName: string;
  nomineePartyColor: string;
  nomineeState?: string;
  nominatedByName: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  status: string;
  votesFor: number;
  voteByParty?: VoteByParty[];
  isMyVote: boolean;
  isMyCandidate: boolean;
}

/** Serialized bloc (coalition or single party) for wire transport. Mirrors `Bloc` in blocs.ts
 * with `Set<string>` → `string[]`. */
export interface BlocDisplay {
  kind: "coalition" | "party";
  id: string;
  displayName: string;
  displayColor: string;
  displayAbbreviation?: string;
  partySlugs: string[];
  seats: number;
  dominantPartySlug: string;
  dominantPartySeats: number;
  coalitionSequentialId?: number;
}

/** State of a motion to vacate the chair (mid-term Speaker removal vote). */
export interface VacateMotionDisplay {
  status: "voting" | "passed" | "failed" | "none";
  targetSpeakerName: string | null;
  filedByName: string | null;
  endsAt: string | null;
  endsOnTurn: number | null;
  /** Seat-scoped seat-weighted tally. */
  votesFor: number;
  votesAgainst: number;
  /** Absolute chamber majority needed to carry the motion. */
  threshold: number;
  totalSeats: number;
  /** The viewer's ballot on the open motion, if any. */
  myVote: "for" | "against" | null;
  /**
   * Pre-whip ballot when a hard Player Whip force-set the viewer's vote on the
   * open motion ("for" | "against" | "unvoted"), else null. Drives the
   * "Whipped by Party" badge and its revert affordance.
   */
  myWhippedFromOriginal: string | null;
  /** True when the viewer (a House member) may file a fresh motion right now. */
  canFile: boolean;
}

export interface SpeakerResponse {
  currentSpeaker: SpeakerDisplay | null;
  activeCandidacies: CandidacyDisplay[];
  /** Motion to vacate the chair — null when the feature has no relevant state. */
  vacateMotion: VacateMotionDisplay;
  election: {
    status: "voting" | "closed" | "cancelled" | "none";
    endsAt: string | null;
    endsOnTurn: number | null;
    startedAt: string | null;
  };
  houseComposition: { party: string; partyName: string; partyColor: string; seats: number }[];
  /** Majority / minority blocs. Bloc == coalition when members are coalesced, else single party. */
  majorityBloc: BlocDisplay | null;
  minorityBloc: BlocDisplay | null;
  /** Chamber-wide largest party slug, alongside the minority bloc's dominant party slug. */
  majorityParty: string | null;
  majoritySeats: number;
  minorityParty: string | null;
  minoritySeats: number;
  isHouseMember: boolean;
  /** True when the viewer's party is eligible under the Speaker role policy. */
  canRunForSpeaker: boolean;
  /** Human-readable label describing the eligibility rule (e.g. "any seated chamber member"). */
  speakerEligibilityLabel: string;
  /**
   * @deprecated Informational only — does NOT gate Speaker candidacy/voting.
   * Tells the viewer whether their party is in the chamber's majority bloc.
   */
  isInMajorityBloc: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
  /** Nomination ID where the viewer's current vote was force-set by a Player Whip. */
  myWhippedFromVoteId: string | null;
  /** Pre-whip value: a previous candidacy ObjectId (string) or "unvoted". */
  myWhippedFromOriginal: string | null;
  isAdmin: boolean;
}
