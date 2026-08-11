// Congress response types shared between API route handlers and UI.
//
// Lives in lib/ so consumers (components, pages) don't have to import from
// `@/app/api/.../route` — that pattern treats route files as a contract surface
// and trips the architecture-audit "app/components importing API route modules"
// rule. Route files re-export from here to keep their own type assertions
// consistent without duplicating definitions.

import type { VoteByParty } from "@/lib/congress/governmentVoteBreakdown";

// ---------------------------------------------------------------------------
// Speaker
// ---------------------------------------------------------------------------
// Speaker types already live in src/lib/congress/speaker/types.ts; re-export
// them from this barrel so consumers have a single import path.
export type {
  SpeakerDisplay,
  CandidacyDisplay,
  BlocDisplay,
  SpeakerResponse,
} from "@/lib/congress/speaker/types";

// ---------------------------------------------------------------------------
// Senate leadership
// ---------------------------------------------------------------------------
import type { BlocDisplay as _BlocDisplay } from "@/lib/congress/speaker/types";

export interface SenateLeaderDisplay {
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName: string;
  partyColor: string;
  state?: string;
  electedAt: string | null;
  isNPP: boolean;
}

export interface SenateCandidacyDisplay {
  id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string;
  nomineePartyName: string;
  nomineePartyColor: string;
  nomineeState?: string;
  nominatedByName: string;
  avatarUrl?: string;
  status: string;
  votesFor: number;
  voteByParty?: VoteByParty[];
  isMyVote: boolean;
  isMyCandidate: boolean;
}

export interface SenateLeaderElectionState {
  current: SenateLeaderDisplay | null;
  candidacies: SenateCandidacyDisplay[];
  election: {
    status: "voting" | "closed" | "cancelled" | "none";
    endsAt: string | null;
    endsOnTurn: number | null;
    startedAt: string | null;
  };
  partyLabel: string;
  partySeats: number;
  isMember: boolean;
  isInParty: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
  /** Nomination ID where the viewer's current vote was force-set by a Player Whip. */
  myWhippedFromVoteId: string | null;
  /** Pre-whip value: a previous candidacy ObjectId string or "unvoted". */
  myWhippedFromOriginal: string | null;
}

export interface SenateLeadershipResponse {
  proTempore: SenateLeaderElectionState;
  majorityLeader: SenateLeaderElectionState;
  minorityLeader: SenateLeaderElectionState;
  /** Senate Majority Whip — second-in-command for the majority party, full whip authority. */
  majorityWhip: SenateLeaderElectionState;
  /** Senate Minority Whip — second-in-command for the opposition, full whip authority. */
  minorityWhip: SenateLeaderElectionState;
  senateComposition: { party: string; partyName: string; partyColor: string; seats: number }[];
  /** Majority / minority blocs (coalition-aware). Bloc == coalition when formed, else single party. */
  majorityBloc: _BlocDisplay | null;
  minorityBloc: _BlocDisplay | null;
  isAdmin: boolean;
  /** @deprecated Use proTempore.current */
  currentProTempore: SenateLeaderDisplay | null;
  /** @deprecated Use proTempore.candidacies */
  activeCandidacies: SenateCandidacyDisplay[];
  senateTotal: number;
  majority: number;
  isMember: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
}

// ---------------------------------------------------------------------------
// House leadership
// ---------------------------------------------------------------------------

export interface HouseLeaderDisplay {
  characterId: string | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName: string;
  partyColor: string;
  state?: string;
  electedAt: string | null;
}

export interface HouseLeaderCandidacyDisplay {
  id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string;
  nomineePartyName: string;
  nomineePartyColor: string;
  nomineeState?: string;
  nominatedByName: string;
  avatarUrl?: string;
  status: string;
  votesFor: number;
  voteByParty?: VoteByParty[];
  isMyVote: boolean;
  isMyCandidate: boolean;
}

export interface HouseLeaderElectionState {
  current: HouseLeaderDisplay | null;
  candidacies: HouseLeaderCandidacyDisplay[];
  election: {
    status: "voting" | "closed" | "cancelled" | "none";
    endsAt: string | null;
    endsOnTurn: number | null;
    startedAt: string | null;
  };
  partyLabel: string;
  partySeats: number;
  isMember: boolean;
  isInParty: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
  /** Nomination ID where the viewer's current vote was force-set by a Player Whip. */
  myWhippedFromVoteId: string | null;
  /** Pre-whip value: a previous candidacy ObjectId string or "unvoted". */
  myWhippedFromOriginal: string | null;
}

export interface HouseLeadershipResponse {
  majorityLeader: HouseLeaderElectionState;
  minorityLeader: HouseLeaderElectionState;
  /** House Majority Whip — second-in-command for the chamber's largest party, full whip authority. */
  majorityWhip: HouseLeaderElectionState;
  /** House Minority Whip — second-in-command for the opposition, full whip authority. */
  minorityWhip: HouseLeaderElectionState;
  houseComposition: { party: string; partyName: string; partyColor: string; seats: number }[];
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Congress members (House / Senate composition)
// ---------------------------------------------------------------------------

export interface CongressMember {
  id: string;
  officeType: "senate" | "house";
  state: string;
  district?: number;
  senateClass?: number;
  seatsHeld: number;
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName: string;
  partyColor: string;
  countryId: "US" | "UK" | "DE";
  /** -5 left → +5 right */
  economicPosition: number;
  isNPP: boolean;
  isVacant: boolean;
  electedAt?: string;
  termEnds?: string;
}

export interface CongressMembersResponse {
  members: CongressMember[];
  composition: {
    party: string;
    partyName: string;
    partyColor: string;
    economicPosition: number;
    seats: number;
  }[];
  totalSeats: number;
  chamber: "senate" | "house";
}
