import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { WhippedFromVoteMap } from "./legislation";
import type { IterationStampFields } from "./gameState";

export type LeadershipRole =
  | "speaker_of_the_house"
  | "majority_leader_house"
  | "minority_leader_house"
  | "majority_whip_house"
  | "minority_whip_house"
  | "president_pro_tempore"
  | "majority_leader_senate"
  | "minority_leader_senate"
  | "majority_whip_senate"
  | "minority_whip_senate"
  // DE Bundestag presiding officer — mirrors `speaker_of_the_house` mechanics
  // (open election, MdB nominations, MdB votes, agenda powers) on a parallel
  // `bundestagspraesidentElections` / `bundestagspraesidentNominations`
  // collection so the US flow stays untouched. See
  // src/lib/congress/bundestagLeadershipElections.ts for the DE-side opener
  // and resolver; UI panel lives on the DE Bundestag page Leadership tab.
  | "speaker_of_the_bundestag"
  // CN Chairman of the NPC Standing Committee — mirrors `speaker_of_the_house`
  // mechanics (open election among seated NPC delegates, delegate nominations,
  // delegate votes, plurality wins) on a parallel `npcscChairElections` /
  // `npcscChairNominations` collection so the US and DE flows stay untouched.
  // See src/lib/congress/npcscChair/ for the CN-side opener and resolver; UI
  // panel lives on the CN NPC page and a read-only card on the exec hub.
  | "chair_npcsc"
  // CN Chairman of the CPPCC — heads the advisory body. Mirrors the US House
  // Majority Leader mechanic (`largest-single-party` eligibility — only the
  // largest NPC party, i.e. the CCP, may declare/vote) on a parallel
  // `cppccChairElections` / `cppccChairNominations` collection. See
  // src/lib/congress/cppccChair/ for the opener and resolver.
  | "chair_cppcc"
  // NG National Assembly presiding officers — the Speaker of the House of
  // Representatives and the President of the Senate. Both mirror
  // `speaker_of_the_bundestag` mechanics (open election, seated-member
  // nominations, seated-member votes, plurality wins) on shared, role-keyed
  // `ngChamberLeadershipElections` / `ngChamberLeadershipNominations`
  // collections. On resolution the winner is written to the presiding-officer
  // `electedOfficials` record (officeType "speaker" / "senatePresident") that
  // the read-only presiding-officers route already surfaces, so the NG
  // Leadership tab stays a single source of truth. See
  // src/lib/congress/ngChamberLeadership/ for the resolver and actions.
  | "speaker_ng_reps"
  | "president_ng_senate";

/**
 * NG National Assembly presiding-officer roles. `speaker_ng_reps` presides
 * over the House of Representatives; `president_ng_senate` presides over the
 * Senate. Used as the `_id` of the shared `ngChamberLeadershipElections`
 * singleton-per-role and the `role` discriminator on nominations.
 */
export type NgChamberLeadershipRole = "speaker_ng_reps" | "president_ng_senate";

/**
 * NG presiding-officer election — one document per role in the shared
 * `ngChamberLeadershipElections` collection (keyed by role, mirroring the
 * House/Senate leadership collections). Lifecycle and resolution rule mirror
 * the DE Bundestagspräsident: 24-hour ballot among seated chamber members,
 * plurality of member votes wins.
 */
export interface NgChamberLeadershipElection {
  _id: NgChamberLeadershipRole;
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes (freeze-safe deadline). */
  endsOnTurn?: number;
  updatedAt: Date;
}

/**
 * NG presiding-officer nomination — stored in `ngChamberLeadershipNominations`
 * with a `role` discriminator. Eligible nominees and voters are the seated
 * members of the matching chamber (officeType "house" for the Speaker,
 * "senate" for the Senate President).
 */
export interface NgChamberLeadershipNomination {
  _id: ObjectId;
  role: NgChamberLeadershipRole;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

export interface CongressLeader extends IterationStampFields {
  _id: ObjectId;
  role: LeadershipRole;
  characterId: ObjectId | null;
  characterName: string;
  party?: string;
  nominatedBy?: ObjectId;
  electedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NominationStatus = "open" | "voting" | "confirmed" | "failed" | "cancelled";

export interface SpeakerElection {
  _id: "current";
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new elections set both. */
  endsOnTurn?: number;
  updatedAt: Date;
}

export interface SpeakerNomination extends IterationStampFields {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Motion to vacate the chair — a mid-term, House-wide vote to remove the sitting
 * Speaker (the real-world "motion to vacate", e.g. Kevin McCarthy 2023).
 * Singleton (`_id: "current"`), mirroring {@link SpeakerElection}'s lazy
 * resolve-on-read lifecycle. Votes are one-per-seated-member ("for" = vacate,
 * "against" = keep); the motion passes when "for" reaches an absolute majority
 * of the chamber, which vacates the Speaker and auto-opens a new election.
 */
export interface SpeakerVacateMotion {
  _id: "current";
  status: "voting" | "passed" | "failed";
  /** Snapshot of who filed the motion and who it targets, for the record. */
  filedById: ObjectId;
  filedByName: string;
  filedByParty?: string;
  targetSpeakerId: ObjectId;
  targetSpeakerName: string;
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes — server resolution keys on this. */
  endsOnTurn?: number;
  /** One vote per seated House member: "for" = vacate, "against" = keep. */
  votes: Record<string, "for" | "against">;
  /** Set when the motion resolves. */
  resolvedAt?: Date;
  updatedAt: Date;
}

/**
 * DE Bundestagspräsident election — singleton document mirroring
 * {@link SpeakerElection}'s shape for the US House Speaker.
 *
 * Stored in collection `bundestagspraesidentElections` (parallel to
 * `speakerElections`) so the existing US Speaker flow stays untouched and
 * the DE election lifecycle can evolve independently. Resolution rule and
 * mechanic mirror the US House Speaker exactly — open election among MdBs,
 * top nominations, MdB votes, simple majority wins.
 */
export interface BundestagspraesidentElection {
  _id: "current";
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new elections set both. */
  endsOnTurn?: number;
  updatedAt: Date;
}

/**
 * DE Bundestagspräsident nomination — mirrors {@link SpeakerNomination}'s
 * shape for the US House Speaker.
 *
 * Stored in collection `bundestagspraesidentNominations` (parallel to
 * `speakerNominations`). Eligible nominees are seated MdBs (Bundestag
 * members); eligible voters are likewise the seated MdBs.
 */
export interface BundestagspraesidentNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CN Chairman of the NPC Standing Committee election — singleton document
 * mirroring {@link SpeakerElection}'s shape for the US House Speaker.
 *
 * Stored in collection `npcscChairElections` (parallel to `speakerElections`)
 * so the US/DE flows stay untouched. Resolution mirrors the US House Speaker:
 * open election among seated NPC delegates, plurality of delegate votes wins.
 */
export interface NpcscChairElection {
  _id: "current";
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence. */
  endsOnTurn?: number;
  updatedAt: Date;
}

/**
 * CN Chairman of the NPC Standing Committee nomination — mirrors
 * {@link SpeakerNomination}. Stored in `npcscChairNominations`. Eligible
 * nominees and voters are seated NPC delegates.
 */
export interface NpcscChairNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CN Chairman of the CPPCC election — singleton document mirroring
 * {@link NpcscChairElection}. Stored in collection `cppccChairElections`.
 * Eligibility is `largest-single-party` (only the largest NPC party, the CCP);
 * voters/nominees are CCP NPC delegates (the CPPCC advisory body is appointed
 * and not modeled as an electable roster).
 */
export interface CppccChairElection {
  _id: "current";
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes (freeze-safe deadline). */
  endsOnTurn?: number;
  updatedAt: Date;
}

/**
 * CN Chairman of the CPPCC nomination — mirrors {@link NpcscChairNomination}.
 * Stored in `cppccChairNominations`.
 */
export interface CppccChairNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

export type HouseLeadershipElectionRole =
  "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip";

export interface HouseLeadershipElection {
  _id: HouseLeadershipElectionRole;
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new elections set both. */
  endsOnTurn?: number;
  updatedAt: Date;
}

export interface HouseLeadershipNomination extends IterationStampFields {
  _id: ObjectId;
  role: HouseLeadershipElectionRole;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

export type SenateLeadershipElectionRole =
  "pro_tempore" | "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip";

export interface SenateLeadershipElection {
  _id: SenateLeadershipElectionRole;
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new elections set both. */
  endsOnTurn?: number;
  updatedAt: Date;
}

export interface SenateLeadershipNomination extends IterationStampFields {
  _id: ObjectId;
  role: SenateLeadershipElectionRole;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeCountryId?: CountryId;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

/** @deprecated Use SenateLeadershipNomination with role "pro_tempore" instead. */
export interface ProTemporeNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: NominationStatus;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  createdAt: Date;
  updatedAt: Date;
}
