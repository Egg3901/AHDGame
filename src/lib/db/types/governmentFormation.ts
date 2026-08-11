import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WhippedFromVoteMap } from "./legislation";
import type { GoverningAgenda } from "@/lib/nppAutonomy/governingAgenda";
import type { PersistedCommandStance, PersistedFiscalStance } from "@/lib/nppAutonomy/fiscalStance";

// --- GovernmentFormation ---

export type GovernmentFormationStatus = "pending" | "formed" | "collapsed";
export type GovernmentFormationType = "majority" | "coalition" | "minority" | "admin";

export interface GovernmentFormation {
  _id: string; // "UK"
  countryId: CountryId;
  cycle: number;

  // Status
  status: GovernmentFormationStatus;
  formationType: GovernmentFormationType | null;
  lostMajority: boolean;

  // Executive — player character PM (null when the head of government is an NPP).
  pmCharacterId: ObjectId | null;
  /**
   * NPP head of government, set when an autonomous NPP PM is seated in a
   * disabled/econ-only country (SP3). Parallel to pmCharacterId; exactly one of
   * the two is non-null for a formed government. The player path never sets it.
   */
  pmNppId?: ObjectId | null;
  pmName: string | null;

  // Parliamentary support
  governingPartyId: string | null; // party sequentialId of largest party
  coalitionId: number | null; // coalition sequentialId if formed via coalition
  coalitionPartyIds: string[] | null; // party sequentialIds in supporting coalition
  totalSeatsSupporting: number;
  majorityThreshold: number; // 326 for UK

  // Seat snapshot — updated every turn
  seatsByParty: Record<string, number>;
  totalSeats: number; // 650 for UK

  // Active vote — only one at a time
  activeVoteId: ObjectId | null;
  /** Short-lived route lock so duplicate PM nominations cannot race into parallel active votes. */
  pmAppointmentNominationLockId?: ObjectId | null;
  /** Expiry for the PM nomination route lock; stale locks are recovered automatically. */
  pmAppointmentNominationLockExpiresAt?: Date | null;

  // Timeline
  formedAt: Date | null;
  formedTurn: number | null;
  collapsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  // Snap election tracking — applies to any parliamentary country
  // (resets on PM appointment).
  /** Number of snap elections used by the current PM. */
  snapElectionsUsed?: number;
  /** Turn number of the last snap election. Null if none triggered this appointment. */
  lastSnapElectionTurn?: number | null;

  // PM vacancy deadline — set when status transitions to "pending".
  // When currentTurn >= pmVacancyDeadlineTurn and no PM has been seated,
  // the turn processor triggers an auto-snap. Cleared when a PM is seated.
  /** Turn at which an auto-snap will fire if the vacancy is unfilled. */
  pmVacancyDeadlineTurn?: number | null;

  /**
   * NPP Autonomy V1+: the seated NPP head of state in a presidential country.
   * Parallel to `pmNppId` (parliamentary head of government); set by
   * `appointNppPresident`. The player path never sets it.
   */
  presidentNppId?: ObjectId | null;
  presidentName?: string | null;

  /**
   * Legislature-appointed ceremonial head of state (RU Chairman of the
   * Presidium — config.headOfStateSelection === "legislatureAppointment").
   * Exactly one of hosCharacterId/hosNppId is non-null when seated; the
   * seeded D5 start links the NPC Chairman via hosNppId. CN's partyChairSync
   * President never writes these.
   */
  hosCharacterId?: ObjectId | null;
  hosNppId?: ObjectId | null;
  hosName?: string | null;

  /**
   * NPP Autonomy V1.2: the governing party's persisted, ranked policy agenda —
   * the multi-turn intent every downstream autonomous lever (bill sponsorship,
   * ministerial governance, fiscal stance) reads from. Recomputed once per
   * cycle by `processNppGovernment`. Absent until the governing brain runs.
   */
  governingAgenda?: GoverningAgenda | null;

  /**
   * NPP Autonomy V1.6: the government's persisted fiscal posture (expansionary /
   * neutral / austere), derived from the agenda + macro position. Biases the
   * tax/spending bills the government sponsors. Recomputed with the agenda.
   */
  fiscalStance?: PersistedFiscalStance | null;

  /**
   * Planned-economy command levers for an NPP-headed government in a command /
   * dual-track country (`commandEconomyEnabled`). `secondEconomyTolerance`
   * feeds `commandEconomyTurn` (per-country override of the global GameConfig
   * lever); `planTightness` is the plan-side companion to fiscal stance.
   * Absent/null for market countries or before the governing brain runs.
   */
  commandStance?: PersistedCommandStance | null;
}

// --- PMAppointmentVote ---

export type PMAppointmentVoteStatus = "active" | "passed" | "failed" | "cancelled";

export interface PMAppointmentVote {
  _id: ObjectId;
  countryId: CountryId;

  /** Which office this appointment vote fills. Absent = head of government (PM). */
  office?: "headOfState";

  // Nomination
  nomineeCharacterId: ObjectId; // player character only
  nomineeName: string;
  nomineePartyId: string; // party sequentialId
  nominatedByCharacterId: ObjectId; // party chair or coalition chair
  formationType: GovernmentFormationType;

  // Coalition context — null for majority/minority
  coalitionId: number | null;
  coalitionPartyIds: string[] | null;

  // Votes
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "aye" | "nay">; // keyed by characterId or nppId string
  whippedFromVote?: WhippedFromVoteMap;

  // S#17: true when auto-filed as a post-election confidence motion.
  // Distinct failure semantics: a failed motion with no alternative
  // seated triggers unformGovernmentAndVacatePM.
  isConfidenceMotion?: boolean;

  // Lifecycle
  status: PMAppointmentVoteStatus;
  openedAt: Date;
  closesAt: Date; // openedAt + 24 hours
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new votes set both. */
  closesOnTurn?: number;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// --- NoConfidenceVote ---

export type NoConfidenceVoteStatus = "active" | "passed" | "failed" | "cancelled";

export interface NoConfidenceVote {
  _id: ObjectId;
  countryId: CountryId;

  // Proposal
  /**
   * Character who proposed the vote. Null when the vote was auto-triggered
   * by the system (Phase 11b: parliamentary sovereign-default fallout).
   */
  proposedByCharacterId: ObjectId | null;
  proposedByName: string;
  targetPmCharacterId: ObjectId;
  targetPmName: string;

  // Votes — all Commons MPs eligible
  votesFor: number; // votes to remove PM
  votesAgainst: number; // votes to keep PM
  votes: Record<string, "aye" | "nay">;
  whippedFromVote?: WhippedFromVoteMap;

  // Lifecycle
  status: NoConfidenceVoteStatus;
  openedAt: Date;
  closesAt: Date; // openedAt + 24 hours
  /** Game turn on which voting closes. Server resolution uses this so the
   *  deadline doesn't drift with real-clock vs game-clock divergence.
   *  Optional during the transition; new votes set both. */
  closesOnTurn?: number;
  closedAt: Date | null;
  turnProposed: number; // for 48-turn cooldown
  createdAt: Date;
  updatedAt: Date;
}
